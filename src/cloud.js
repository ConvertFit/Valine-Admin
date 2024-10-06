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

// 预注册
function registerUser(comment) {
    const email = (comment.get('mail') || '').trim().toLowerCase();
    const nickName = (comment.get('nick') || '').trim();
    // 创建实例
    const user = new AV.User();

    // 等同于 user.set('username', 'Tom')
    user.setUsername(email);
    user.setPassword('123456');
    // 可选
    user.setEmail(email);

    // 设置其他属性的方法跟 AV.Object 一样
    user.set("nickName", nickName);

    user.signUp().then(
      (user) => {
          // 注册成功
          console.log(`用户注册成功。objectId：${user.id}`);
      },
      (error) => {
          // 注册失败（通常是因为用户名已被使用）
          console.warn('用户注册失败，改执行用户更新', error && error.message);
          
          user.save().then(
            (user) => {
                // 保存成功
                console.log(`用户更新成功。objectId：${user.id}`);
            },
            (error) => {
                // 注册失败（通常是因为用户名已被使用）
                console.warn('更新失败', error && error.message);
            }
          )
      }
    );
}

AV.Cloud.afterSave('Comment', function (request) {
    let currentComment = request.object;

    // 通知站长
    mailService.notice(currentComment);
    // 通知被 @ 的人
    sendReplyNotification(currentComment);
    // 预注册
    registerUser(currentComment);
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
