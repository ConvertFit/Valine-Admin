const AV = require('leanengine');
const mailService = require('./utilities/mailService');
const Comment = AV.Object.extend('Comment');
const request = require('request');
// setting access
function getAcl() {
    let acl = new AV.ACL();
    acl.setPublicReadAccess(!0);
    acl.setPublicWriteAccess(!1);
    return acl;
}
// 将此comment通知给被 @ 的人
function sendReplyNotification(currentComment) {
    return new Promise((resolve, reject)=>{
        // AT评论通知
        let pid = currentComment.get('pid');

        if (!pid) {
            console.log("这条评论没有 @ 任何人");
            resolve(1);
            return;
        }

        // 通过被 @ 的评论 id, 则找到这条评论留下的邮箱并发送通知.
        let query = new AV.Query('Comment');
        query.get(pid).then(function (parentComment) {
            if (parentComment.get('mail')) {
                mailService.send(currentComment, parentComment);
            } else {
                console.log(currentComment.get('nick') + " @ 了" + parentComment.get('nick') + ", 但被 @ 的人没留邮箱... 无法通知");
            }
            resolve(1);
        }, function (error) {
            console.warn('好像 @ 了一个不存在的人!!!', error && error.message);
            resolve(0);
        });
    })
}
// 用户注册
function userSignUp(payload, needSave = false) {
    // 创建实例
    const user = new AV.User();
    Object.keys(payload).forEach(key => {
        if (key === 'password') {
            user.setPassword(payload[key] || '123456');
        } else {
            // 非password全部trim下
            const value = (payload[key] || '').trim();
            if (key === 'email') {
                user.setUsername(value.toLowerCase());
                user.setEmail(value.toLowerCase());
            } else {
                user.set(key, value);
            }
        }
    })

    return user.signUp().then(
      (result) => {
          // 注册成功
          console.log(`注册用户${payload.email}成功。objectId：${result.id}`);
          return result;
      },
      (error) => {
          // 注册失败（通常是因为用户名已被使用）
          if (needSave) {
              console.warn(`注册用户${payload.email}失败，原因：`, error && error.message, '尝试改为执行更新用户');
              userSave(user, payload);
          } else {
              console.warn(`注册用户${payload.email}失败，原因：`, error && error.message);
          }
      });
}
// 更新用户
function userSave(user, payload) {
    return user.save().then(
      (result) => {
          // 保存成功
          console.log(`更新用户${result.email}成功。objectId：${result.id}`);
          return result
      },
      (error) => {
          // 注册失败（通常是因为用户名已被使用）
          console.warn(`更新用户${payload.email}失败，原因：`, error && error.message);
      }
    )
}

// 注册用户
function registerUser(userInfo) {
    return userSignUp({
        email: userInfo.email,
        password: userInfo.password,
        nickName: userInfo.userName,
    }, true);
}
// 将试用模式生成的转换记录同步到评论
function sendTrialComment(data) {
    if (!data.address || data.status !== 'success' || !/^trial_/.test(data.recordMode)) {
        console.log('No need to sync record to comment, ignore.');
        console.log(`address=${data.address} status=${data.status} recordMode=${data.recordMode}`);
        return;
    }
    const comment = new Comment();
    const nickName = (data.type || '') + '跑友'
    comment.set('mail', data.address);
    comment.set('nick', nickName);
    comment.set('comment', '我成功使用了试用模式');
    comment.set('url', '/convert/do');
    comment.set('ua', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0');
    
    comment.setACL(getAcl());
    comment.save().then(() => {
        console.log('sendTrialComment success ~ ', data.address);
    }).catch(err => {
        console.error('sendTrialComment error ~ ', err && err.message, data.address);
    })
}

AV.Cloud.afterSave('Record', function (request) {
    const currentRecord = request.object;
    // 根据转换记录注册用户
    const address = currentRecord.get('address');
    if (!address) {
        console.log(`address is empty fileName=${currentRecord.get('fileName')}`);
        return;
    }
    registerUser({
        email: address,
    });
});

AV.Cloud.afterUpdate('Record', function (request) {
    const currentRecord = request.object;
    // 根据转换记录注册用户
    const address = currentRecord.get('address');
    if (!address) {
        console.log(`address is empty fileName=${currentRecord.get('fileName')}`);
        return;
    }
    sendTrialComment({
        address,
        status: currentRecord.get('status'),
        recordMode: currentRecord.get('recordMode'),
        type: currentRecord.get('type'),
    });
});

AV.Cloud.afterSave('Comment', function (request) {
    const currentComment = request.object;
    // 通知站长
    mailService.notice(currentComment);
    // 通知被 @ 的人
    sendReplyNotification(currentComment);
    // 根据评论注册用户
    registerUser({
        email: currentComment.get('mail'),
        nickName: currentComment.get('nick'),
    });
});

AV.Cloud.define('resend_mails', function(req) {
    const query = new AV.Query(Comment);
    query.greaterThanOrEqualTo('createdAt', new Date(new Date().getTime() - 24*60*60*1000));
    query.notEqualTo('isNotified', true);
    query.exists('pid');
    // 如果你的评论量很大，可以适当调高数量限制，最高1000
    query.limit(200);
    return query.find().then(function(commentList) {
        return new Promise(async (resolve)=>{
            const totalCount = commentList.length;
            let successCount = 0;
            for (comment of commentList) {
                const sendCount = await sendReplyNotification(comment);
                successCount += sendCount;
            }
            resolve({ totalCount, successCount });
        }).then(({ totalCount, successCount })=>{
            console.log(`昨日${totalCount}条未成功发送的通知邮件，现已成功处理${successCount}条！`);
        }).catch((error)=>{
            console.warn('resend_mails error ~ ', error && error.message);
        });
    });
});
// 更新计数
function updateCount(result, key, prop) {
    key = key.toLowerCase();
    let target = result.find(item => item.key === key);
    if (!target) {
        target = {
            key,
        }
        result.push(target);
    }
    if (!target[prop]) {
        target[prop] = 0;
    }
    target[prop] += 1;
    
    return result;
}
// 评论统计
AV.Cloud.define('comment_statistics', function(req) {
    const query = new AV.Query(Comment);
    // 统计前7天零点以后的评论
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startTs = todayStart.getTime() - 6*24*60*60*1000;
    query.greaterThanOrEqualTo('createdAt', new Date(startTs));
    query.limit(200);
    return query.find().then(function(commentList) {
        return new Promise(async (resolve)=>{
            const commentCount = commentList.length;
            const mailList = [];
            const parentCommentList = []; // 被评论的评论
            const parentMailList = []; // 被评论的评论的邮箱
            const list = [];
            console.log('commentList.length ~ ', commentList.length);
            for (comment of commentList) {
                let mail = comment.get('mail');
                if (mail && mail.trim()) {
                    mail = mail.trim().toLowerCase();
                    updateCount(list, mail, 'comment');
                    if (!mailList.includes(mail)) {
                        mailList.push(mail);
                    }
                }
                const parentCommentId = comment.get('pid');
                if (parentCommentId) {
                    const parentCommentQuery = new AV.Query('Comment');
                    parentCommentQuery.equalTo('objectId', parentCommentId);
                    await parentCommentQuery.find().then((parentComments)=>{
                        const [parentComment] = parentComments;
                        console.log(`${parentCommentId} parentComments.length ~ `, parentComments.length);
                        parentCommentList.push(parentComment);
                        let parentMail = parentComment.get('mail');
                        console.log('parentComment', parentMail, mail);
                        // 被评论，且评论者和被评论者非同一个人
                        if (parentMail && parentMail.trim()) {
                            parentMail = parentMail.trim().toLowerCase();
                            if (parentMail !== mail) {
                                updateCount(list, parentMail, 'commented');
                                if (!parentMailList.includes(parentMail)) {
                                    parentMailList.push(parentMail);
                                }
                            }
                        }
                    })
                }
            }
            resolve({ 
                commentCount,
                mailCount: mailList.length,
                parentCommentCount: parentCommentList.length,
                parentMailCount: parentMailList.length,
                list,
            });
        }).then(value => {
            const { commentCount, mailCount, parentCommentCount, parentMailCount, list } = value;
            console.log(`过去7天统计数据：`);
            console.log(`共有${commentCount}条评论，涉及${mailCount}个邮箱；`);
            console.log(`共有${parentCommentCount}条评论被@，涉及${parentMailCount}个邮箱；`);
            const maxCommentObj = list.reduce((maxObj, obj) => {
                return obj.comment > maxObj.comment ? obj : maxObj;
            }, {
                comment: 0
            });
            console.log(`${maxCommentObj.key}评论次数最多，共${maxCommentObj.comment}条；`);
            const maxCommentedObj = list.reduce((maxObj, obj) => {
                return obj.commented > maxObj.commented ? obj : maxObj;
            }, {
                commented: 0
            });
            console.log(`${maxCommentedObj.key}被@次数最多，共${maxCommentedObj.comment}次。`);
        }).catch((error)=>{
            console.warn('comment_statistics error ~ ', error && error.message);
        });
    });
})


AV.Cloud.define('self_wake', function(req) {
    console.log('run self_wake ~ ', process.env.ADMIN_URL);
    request(process.env.ADMIN_URL, function (error, response, body) {
        console.log('自唤醒任务执行成功，响应状态码为:', response && response.statusCode);
    });
})
