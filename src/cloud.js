const AV = require('leanengine');
const mailService = require('./utilities/mailService');
const Comment = AV.Object.extend('Comment');
const request = require('request');

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

    return new Promise((resolve, reject) => {
        user.signUp().then(
          (result) => {
              // 注册成功
              console.log(`注册用户${result.email}成功。objectId：${result.id}`);
              resolve(result);
          },
          (error) => {
              // 注册失败（通常是因为用户名已被使用）
              if (needSave) {
                  console.warn(`注册用户${user.email}失败，原因：`, error && error.message, '尝试改为执行更新用户');
                  userSave(user);
              } else {
                  console.warn(`注册用户${user.email}失败，原因：`, error && error.message);
              }
              reject(error);
          }
        ); 
    });
}
// 更新用户
function userSave(user) {
    return user.save().then(
      (result) => {
          // 保存成功
          console.log(`更新用户${result.email}成功。objectId：${result.id}`);
      },
      (error) => {
          // 注册失败（通常是因为用户名已被使用）
          console.warn(`更新用户${user.email}失败，原因：`, error && error.message);
      }
    )
}

// 根据评论注册用户
function registerUserFromComment(comment) {
    return userSignUp({
        email: comment.get('mail'),
        password: '',
        nickName: comment.get('nick'),
    }, true);
}

AV.Cloud.afterSave('Comment', function (request) {
    let currentComment = request.object;

    // 通知站长
    mailService.notice(currentComment);
    // 通知被 @ 的人
    sendReplyNotification(currentComment);
    // 根据评论注册用户
    registerUserFromComment(currentComment);
});

AV.Cloud.define('resend_mails', function(req) {
    let query = new AV.Query(Comment);
    query.greaterThanOrEqualTo('createdAt', new Date(new Date().getTime() - 24*60*60*1000));
    query.notEqualTo('isNotified', true);
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
            console.log('error ~ ', error && error.message);
        });
    });
});

AV.Cloud.define('self_wake', function(req) {
    console.log('run self_wake ~ ', process.env.ADMIN_URL);
    request(process.env.ADMIN_URL, function (error, response, body) {
        console.log('自唤醒任务执行成功，响应状态码为:', response && response.statusCode);
    });
})
