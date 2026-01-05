'use strict';

// FIXED: Use require.main.require instead of module.parent.require for NodeBB v4 compatibility
const Categories = require.main.require('./src/categories');
const posts = require.main.require('./src/posts');
const Topics = require.main.require('./src/topics');
const Users = require.main.require('./src/user');
const Groups = require.main.require('./src/groups');
const db = require.main.require('./src/database');
const privileges = require.main.require('./src/privileges');
const Settings = require.main.require('./src/settings');

// Plugin dependencies
const axios = require('axios');
const async = require('async');
const _ = require('lodash');
const apiMiddleware = require('./middleware');
const responseMessage = require('./responseHandler');
const jsonConstants = require('./lib/constants');
const util = require('./lib/utils');
const utils = require('./utils');

// FIXED: Use require.main.require for config.json with better error handling
let configData;
try {
  configData = require.main.require('./config.json');
  console.log('[nodebb-plugin-sunbird-api] Config.json loaded successfully');
} catch (error) {
  console.log('[nodebb-plugin-sunbird-api] Could not load config.json:', error.message);
  console.log('[nodebb-plugin-sunbird-api] Using environment variables for configuration');
  // Fallback to environment variables and default config
  configData = {
    database: process.env.database || 'redis',
    redis: {
      host: process.env.redis__host || 'localhost',
      port: process.env.redis__port || 6379,
      database: process.env.redis__database || 0
    }
  };
}

let client;

// Import library functions
const {
  createCategory,
  createCategory_check,
  createGroupDefault,
  addPrivileges,
  addSection,
  createForum,
  createGroup,
  getForum,
  createTopic,
  replyTopic
} = require('./library');

// Constants and URLs - FIXED: Use /discussions/api prefix with clean paths
const createTenantURL = '/discussions/api/org/v1/setup';
const createForumURL = '/discussions/api/forum/v1/create';
const createSectionURL = '/discussions/api/org/v1/sections/add';
const getForumURL = '/discussions/api/forum/v1/read';
const categoryList = '/discussions/api/category/list';
const tagsList = '/discussions/api/tags/list';
const contextBasesTags = '/discussions/api/forum/tags';
const allTopicsByCategoryURL = '/discussions/api/category/v1/topic';
const allPostsByTopicURL = '/discussions/api/topic/v1/posts';
const replyTopicURL = '/discussions/api/topic/v1/reply';
const createTopicURL = '/discussions/api/topic/v1/create';
const voteURL = '/discussions/api/:pid/vote';
const deletePostURL = '/discussions/api/post/v1/delete/:pid';
const deleteTopicURL = '/discussions/api/topic/v1/delete/:tid';
const purgePostURL = '/discussions/api/post/v1/purge/:pid';
const purgeTopicURL = '/discussions/api/topic/v1/purge/:tid';
const banUserURL = '/discussions/api/user/v1/ban';
const unbanUserURL = '/discussions/api/user/v1/unban';
const createCatwithSubcatURL = '/discussions/api/create';
const createSBForum = '/discussions/api/forum/v2/create';
const getSBForum = '/discussions/api/forum/v2/read';
const removeSBForum = '/discussions/api/forum/v2/remove';
const createRelatedDiscussions = '/discussions/api/forum/v3/create';
const copyPrivilages = '/discussions/api/privileges/v2/copy';
const getUids = '/discussions/api/forum/v2/uids';
const usersList = '/discussions/api/forum/v2/users/details';
const addUserIntoGroup = '/discussions/api/forum/v3/group/membership';
const groupsPriveleges = '/discussions/api/forum/v3/category/:cid/privileges';
const listOfGroupUsers = '/discussions/api/forum/v3/groups/users';
const updateUserProfile = '/discussions/api/forum/v3/user/profile';

var constants = {
  'name': 'sunbird-oidc',
  'key': 'list',
  'category': '/category',
  'tags': '/tags',
  'errorResCode': 'SERVER_ERROR',
  'payloadError': "Request payload error",
  'resCode': 'OK',
  'statusFailed': 'failed',
  'http_protocal': 'http',
  'statusSuccess': 'Success',
  '/forum/category/list': 'api.discussions.category.list',
  'forum/tags/list': 'api.discussion.tags.list',
  '/forum/forum/v3/create': 'api.forum.v3.create',
  'createCategory': '/v2/categories',
  'createForum': '/forum/v2/create',
  'getForum': '/forum/v2/read',
  'addUserIntoGroup': '/v2/groups/:slug/membership/:uid',
  'createPrivileges': '/v2/categories/:cid/privileges',
  '/forum/privileges/v2/copy': 'api.privileges.v2.copy',
  'defaultCategory': 'General Discussion',
  'post': 'POST',
  'get': 'GET',
  'put': 'PUT',
  'apiPrefix': '/discussions/api',
  'emptyGroupsMsg': "Groups and CID should not be empty",
  'incorrectCid': 'Category id ${cid} is not exists, Please use correct cid',
  'emptyDataFOrGroupsAndMembers': 'Groups and members should not be empty',
  'noGroupAddedMsg': '${group} was not added for the category id ${cid}, please add and try again.',
  'emptyDataForGroups': 'You have to pass both sbUid and sbUserName',
  'pluginSettings': new Settings('fusionauth-oidc', '1.0.0', {
    clientId: "",
    clientSecret: "",
    emailClaim: 'email',
    discoveryBaseURL: "",
    authorizationEndpoint: "",
    tokenEndpoint: "",
    ssoTokenEndpoint: "",
    userInfoEndpoint: "",
    emailDomain: ""
  }, false, false),
};

// All the API handler functions (preserved from original)
async function createTopicAPI(req, res) {
  var payload = { ...req.body.request };
  console.log('-----------payload ---------------', payload);
  payload.tags = payload.tags || [];
  payload.uid = payload._uid ? payload._uid : req.user.uid;

  return createTopic(payload)
    .then(topicObj => {
      let resObj = {
        id: 'api.discussions.topic.create',
        msgId: req.body.params.msgid,
        status: 'successful',
        resCode: 'OK',
        data: topicObj
      };
      return res.json(responseMessage.successResponse(resObj));
    })
    .catch(error => {
      console.log('--------------error 00000000', error);
      let resObj = {
        id: 'api.discussions.topic.create',
        msgId: req.body.params.msgid,
        status: 'failed',
        resCode: 'SERVER_ERROR',
        err: error.status,
        errmsg: error.message
      };
      return res.json(responseMessage.errorResponse(resObj));
    });
}

async function allTopicsByCategory(req, res) {
  var payload = { ...req.body.request };

  axios
    .get(`http://localhost:4567/forum/category/${payload.cid}`)
    .then(topicObj => {
      let resObj = {
        id: 'api.discussions.topic.all',
        msgId: req.body.params.msgid,
        status: 'successful',
        resCode: 'OK',
        data: topicObj.data
      };
      return res.json(responseMessage.successResponse(resObj));
    })
    .catch(error => {
      console.log(error);
      let resObj = {
        id: 'api.discussions.topic.all',
        msgId: req.body.params.msgid,
        status: 'failed',
        resCode: 'SERVER_ERROR',
        err: error.status,
        errmsg: error.message
      };
      return res.json(responseMessage.errorResponse(resObj));
    });
}

async function allPostsByTopic(req, res) {
  var payload = { ...req.body.request };
  console.log('--------------------', payload);
  axios
    .get(`http://localhost:4567/forum/topic/${payload.tid}`)
    .then(postObj => {
      let resObj = {
        id: 'api.discussions.reply.all',
        msgId: req.body.params.msgid,
        status: 'successful',
        resCode: 'OK',
        data: postObj.data
      };
      return res.json(responseMessage.successResponse(resObj));
    })
    .catch(error => {
      let resObj = {
        id: 'api.discussions.reply.all',
        msgId: req.body.params.msgid,
        status: 'failed',
        resCode: 'SERVER_ERROR',
        err: error.status,
        errmsg: error.message
      };
      return res.json(responseMessage.errorResponse(resObj));
    });
}

async function replyTopicAPI(req, res) {
  let { body } = req;

  var payload = {
    tid: body.request.tid,
    uid: req.user.uid,
    req: utils.buildReqObject(req),
    content: body.request.content,
    timestamp: body.request.timestamp || Date.now()
  };

  if (req.body.toPid) {
    payload.toPid = body.request.toPid;
  }

  return replyTopic(payload)
    .then(topicObj => {
      let resObj = {
        id: 'api.discussions.topic.reply',
        msgId: req.body.params.msgid,
        status: 'successful',
        resCode: 'OK',
        data: topicObj
      };
      return res.status(200).json(responseMessage.successResponse(resObj));
    })
    .catch(error => {
      let resObj = {
        id: 'api.discussions.topic.reply',
        msgId: req.body.params.msgid,
        status: 'failed',
        resCode: 'SERVER_ERROR',
        err: error.status,
        errmsg: error.message
      };
      return res.status(400).json(responseMessage.errorResponse(resObj));
    });
}

async function deletePostAPI(req, res) {
  let { body } = req;
  posts.delete(req.params.pid, req.user.uid, function (error) {
    if (error) {
      let resObj = {
        id: 'api.discussions.delete.post',
        msgId: req.body.params.msgid,
        status: 'failed',
        resCode: 'SERVER_ERROR',
        err: error.status,
        errmsg: error.message
      };
      return res.status(400).json(responseMessage.errorResponse(resObj));
    }
    let resObj = {
      id: 'api.discussions.delete.post',
      msgId: req.body.params.msgid,
      status: 'successful',
      resCode: 'OK',
      data: null
    };
    return res.status(200).json(responseMessage.successResponse(resObj));
  });
}

async function deleteTopicAPI(req, res) {
  Topics.delete(req.params.tid, req.params._uid, function (error) {
    if (error) {
      let resObj = {
        id: 'api.discussions.delete.topic',
        msgId: req.body.params.msgid,
        status: 'failed',
        resCode: 'SERVER_ERROR',
        err: error.status,
        errmsg: error.message
      };
      return res.status(400).json(responseMessage.errorResponse(resObj));
    }
    let resObj = {
      id: 'api.discussions.delete.topic',
      msgId: req.body.params.msgid,
      status: 'successful',
      resCode: 'OK',
      data: null
    };
    return res.status(200).json(responseMessage.successResponse(resObj));
  });
}

async function purgeTopicAPI(req, res) {
  Topics.purgePostsAndTopic(req.params.tid, req.params._uid, function (error) {
    if (error) {
      let resObj = {
        id: 'api.discussions.purge.topic',
        msgId: req.body.params.msgid,
        status: 'failed',
        resCode: 'SERVER_ERROR',
        err: error.status,
        errmsg: error.message
      };
      return res.status(400).json(responseMessage.errorResponse(resObj));
    }
    let resObj = {
      id: 'api.discussions.purge.topic',
      msgId: req.body.params.msgid,
      status: 'successful',
      resCode: 'OK',
      data: null
    };
    return res.status(200).json(responseMessage.successResponse(resObj));
  });
}

async function purgePostAPI(req, res) {
  posts.purge(req.params.pid, req.user.uid, function (error) {
    if (error) {
      let resObj = {
        id: 'api.discussions.purge.post',
        msgId: req.body.params.msgid,
        status: 'failed',
        resCode: 'SERVER_ERROR',
        err: error.status,
        errmsg: error.message
      };
      return res.status(400).json(responseMessage.errorResponse(resObj));
    }
    let resObj = {
      id: 'api.discussions.purge.post',
      msgId: req.body.params.msgid,
      status: 'successful',
      resCode: 'OK',
      data: null
    };
    return res.status(200).json(responseMessage.errorResponse(resObj));
  });
}

async function voteURLAPI(req, res) {
  let { body } = req;

  if (body.request.delta > 0) {
    posts.upvote(req.params.pid, req.user.uid, function (error, data) {
      if (error) {
        let resObj = {
          id: 'api.discussions.post.vote',
          msgId: req.body.params.msgid,
          status: 'failed',
          resCode: 'SERVER_ERROR',
          err: error.status,
          errmsg: error.message
        };
        return res.status(400).json(responseMessage.errorResponse(resObj));
      }
      let resObj = {
        id: 'api.discussions.post.vote',
        msgId: req.body.params.msgid,
        status: 'successful',
        resCode: 'OK',
        data: data
      };
      return res.status(200).json(responseMessage.successResponse(resObj));
    });
  } else if (body.request.delta < 0) {
    posts.downvote(req.params.pid, req.user.uid, function (error, data) {
      if (error) {
        let resObj = {
          id: 'api.discussions.post.vote',
          msgId: req.body.params.msgid,
          status: 'failed',
          resCode: 'SERVER_ERROR',
          err: error.status,
          errmsg: error.message
        };
        return res.status(400).json(responseMessage.errorResponse(resObj));
      }
      let resObj = {
        id: 'api.discussions.post.vote',
        msgId: req.body.params.msgid,
        status: 'successful',
        resCode: 'OK',
        data: data
      };
      return res.status(200).json(responseMessage.successResponse(resObj));
    });
  } else {
    posts.unvote(req.params.pid, req.user.uid, function (error, data) {
      if (error) {
        let resObj = {
          id: 'api.discussions.post.vote',
          msgId: req.body.params.msgid,
          status: 'failed',
          resCode: 'SERVER_ERROR',
          err: error.status,
          errmsg: error.message
        };
        return res.status(400).json(responseMessage.errorResponse(resObj));
      }
      let resObj = {
        id: 'api.discussions.post.vote',
        msgId: req.body.params.msgid,
        status: 'successful',
        resCode: 'OK',
        data: data
      };
      return res.status(200).json(responseMessage.successResponse(resObj));
    });
  }
}

async function banUserAPI(req, res) {
  let { body } = req;

  Users.bans.ban(
    body.request.uid,
    body.request.until || 0,
    body.request.reason || '',
    function (error) {
      if (error) {
        let resObj = {
          id: 'api.discussions.user.ban',
          msgId: req.body.params.msgid,
          status: 'failed',
          resCode: 'SERVER_ERROR',
          err: error.status,
          errmsg: error.message
        };
        return res.status(400).json(responseMessage.errorResponse(resObj));
      }
      let resObj = {
        id: 'api.discussions.user.ban',
        msgId: req.body.params.msgid,
        status: 'successful',
        resCode: 'OK',
        data: null
      };
      return res.status(200).json(responseMessage.successResponse(resObj));
    }
  );
}

async function unbanUserAPI(req, res) {
  let { body } = req;

  Users.bans.unban(body.request.uid, function (error) {
    if (error) {
      let resObj = {
        id: 'api.discussions.user.ban',
        msgId: req.body.params.msgid,
        status: 'failed',
        resCode: 'SERVER_ERROR',
        err: error.status,
        errmsg: error.message
      };
      return res.status(400).json(responseMessage.errorResponse(resObj));
    }
    let resObj = {
      id: 'api.discussions.user.ban',
      msgId: req.body.params.msgid,
      status: 'successful',
      resCode: 'OK',
      data: null
    };
    return res.status(200).json(responseMessage.successResponse(resObj));
  });
}

async function setupOrgAPI(req, res) {
  let { body } = req;
  var reqPrivileges = body.request.privileges;
  return createCategory(body.request)
    .then(catResponse => {
      if (catResponse) {
        let allCatIds = [];
        catResponse.sectionObj.map(section => {
          allCatIds.push(section.cid);
        });
        allCatIds.push(catResponse.categoryObj.cid);
        return addPrivileges(reqPrivileges, allCatIds)
          .then(privilegesResponse => {
            let resObj = {
              id: 'api.discussions.org.setup',
              msgId: req.body.params.msgid,
              status: 'successful',
              resCode: 'OK',
              data: catResponse
            };
            return res.json(responseMessage.successResponse(resObj));
          })
          .catch(error => {
            let resObj = {
              id: 'api.discussions.org.setup',
              msgId: req.body.params.msgid,
              status: 'failed',
              resCode: 'SERVER_ERROR',
              err: error.status,
              errmsg: error.message
            };
            return res.json(responseMessage.errorResponse(resObj));
          });
      }
    })
    .catch(error => {
      let resObj = {
        id: 'api.discussions.org.setup',
        msgId: req.body.params.msgid,
        status: 'failed',
        resCode: 'SERVER_ERROR',
        err: error.status,
        errmsg: error.message
      };
      return res.json(responseMessage.errorResponse(resObj));
    });
}

async function addSectionURL(req, res) {
  let { body } = req;
  var reqPrivileges = body.request.privileges;
  return addSection(body.request)
    .then(catResponse => {
      let allCatIds = [];
      catResponse.sectionObj.map(section => {
        allCatIds.push(section.cid);
      });
      return addPrivileges(reqPrivileges, allCatIds)
        .then(privilegesResponse => {
          let resObj = {
            id: 'api.discussions.org.section.add',
            msgId: req.body.params.msgid,
            status: 'successful',
            resCode: 'OK',
            data: catResponse
          };
          return res.json(responseMessage.successResponse(resObj));
        })
        .catch(error => {
          let resObj = {
            id: 'api.discussions.org.section.add',
            msgId: req.body.params.msgid,
            status: 'failed',
            resCode: 'SERVER_ERROR',
            err: error.status,
            errmsg: error.message
          };
          return res.json(responseMessage.errorResponse(resObj));
        });
    })
    .catch(error => {
      let resObj = {
        id: 'api.discussions.org.section.add',
        msgId: req.body.params.msgid,
        status: 'failed',
        resCode: 'SERVER_ERROR',
        err: error.status,
        errmsg: error.message
      };
      return res.json(responseMessage.errorResponse(resObj));
    });
}

async function createForumAPI(req, res) {
  let { body } = req;
  var reqPrivileges = body.request.privileges;

  if (!body.request.organisationId && !body.request.context) {
    let resObj = {
      id: 'api.discussions.forum.create',
      msgId: req.body.params.msgid,
      status: 'failed',
      resCode: 'SERVER_ERROR',
      err: 401,
      errmsg: 'Please provide orgId or context! something is missing'
    };
    return res.json(responseMessage.errorResponse(resObj));
  } else {
    return createForum(body.request)
      .then(catResponse => {
        let allCatIds = [];
        allCatIds.push(catResponse.cid);
        if (body.request.groups && body.request.privileges) {
          return createGroup(body.request, allCatIds)
            .then(groupObj => {
              return addPrivileges(reqPrivileges, allCatIds)
                .then(privilegesResponse => {
                  let resObj = {
                    id: 'api.discussions.forum.create',
                    msgId: req.body.params.msgid,
                    status: 'successful',
                    resCode: 'OK',
                    data: catResponse
                  };
                  return res.json(responseMessage.successResponse(resObj));
                })
                .catch(error => {
                  let resObj = {
                    id: 'api.discussions.forum.create',
                    msgId: req.body.params.msgid,
                    status: 'failed',
                    resCode: 'SERVER_ERROR',
                    err: error.status,
                    errmsg: error.message
                  };
                  return res.json(responseMessage.errorResponse(resObj));
                });
            })
            .catch(error => {
              let resObj = {
                id: 'api.discussions.forum.create',
                msgId: req.body.params.msgid,
                status: 'failed',
                resCode: 'SERVER_ERROR',
                err: error.status,
                errmsg: error.message
              };
              return res.json(responseMessage.errorResponse(resObj));
            });
        } else if (body.request.groups && !body.request.privileges) {
          return createGroup(body.request, allCatIds)
            .then(groupObj => {
              let resObj = {
                id: 'api.discussions.forum.create',
                msgId: req.body.params.msgid,
                status: 'successful',
                resCode: 'OK',
                data: catResponse
              };
              return res.json(responseMessage.successResponse(resObj));
            })
            .catch(error => {
              let resObj = {
                id: 'api.discussions.forum.create',
                msgId: req.body.params.msgid,
                status: 'failed',
                resCode: 'SERVER_ERROR',
                err: error.status,
                errmsg: error.message
              };
              return res.json(responseMessage.errorResponse(resObj));
            });
        } else if (!body.request.groups && body.request.privileges) {
          return addPrivileges(reqPrivileges, allCatIds)
            .then(privilegesResponse => {
              let resObj = {
                id: 'api.discussions.forum.create',
                msgId: req.body.params.msgid,
                status: 'successful',
                resCode: 'OK',
                data: catResponse
              };
              return res.json(responseMessage.successResponse(resObj));
            })
            .catch(error => {
              let resObj = {
                id: 'api.discussions.forum.create',
                msgId: req.body.params.msgid,
                status: 'failed',
                resCode: 'SERVER_ERROR',
                err: error.status,
                errmsg: error.message
              };
              return res.json(responseMessage.errorResponse(resObj));
            });
        } else {
          let resObj = {
            id: 'api.discussions.forum.create',
            msgId: req.body.params.msgid,
            status: 'successful',
            resCode: 'OK',
            data: catResponse
          };
          return res.json(responseMessage.successResponse(resObj));
        }
      })
      .catch(error => {
        let resObj = {
          id: 'api.discussions.forum.create',
          msgId: req.body.params.msgid,
          status: 'failed',
          resCode: 'SERVER_ERROR',
          err: error.status,
          errmsg: error.message
        };
        return res.json(responseMessage.errorResponse(resObj));
      });
  }
}

async function getForumAPI(req, res) {
  let { body } = req;
  return getForum(body.request)
    .then(forumResponse => {
      let resObj = {
        id: 'api.discussions.forum.read',
        msgId: req.body.params.msgid,
        status: 'successful',
        resCode: 'OK',
        data: forumResponse
      };
      return res.json(responseMessage.successResponse(resObj));
    })
    .catch(error => {
      let resObj = {
        id: 'api.discussions.forum.read',
        msgId: req.body.params.msgid,
        status: 'failed',
        resCode: 'SERVER_ERROR',
        err: error.status,
        errmsg: error.message
      };

      return res.json(responseMessage.errorResponse(resObj));
    });
}

async function createCatwithSubcat(req, res) {
  let { body } = req;
  return createCategory_check(body.request)
    .then(catResponse => {
      if (catResponse) {
        let allCatIds = [];
        catResponse.sectionObj.map(section => {
          allCatIds.push(section.cid);
        });
        allCatIds.push(catResponse.categoryObj.cid);

        return createGroupDefault(body.request, req.user.uid, allCatIds)
          .then(groupObj => {
            let resObj = {
              id: 'api.discussions.forum.create',
              msgId: req.body.params.msgid,
              status: 'successful',
              resCode: 'OK',
              data: catResponse
            };
            return res.json(responseMessage.successResponse(resObj));
          })
          .catch(error => {
            let resObj = {
              id: 'api.discussions.forum.create',
              msgId: req.body.params.msgid,
              status: 'failed',
              resCode: 'SERVER_ERROR',
              err: error.status,
              errmsg: error.message
            };
            return res.json(responseMessage.errorResponse(resObj));
          });
      }
    })
    .catch(error => {
      let resObj = {
        id: 'api.discussions.org.setup',
        msgId: req.body.params.msgid,
        status: 'failed',
        resCode: 'SERVER_ERROR',
        err: error.status,
        errmsg: error.message
      };
      return res.json(responseMessage.errorResponse(resObj));
    });
}

function commonObject(res, id, msgId, status, resCode, err, errmsg, data) {
  let resObj = null;
  if (res === 0) {
    resObj = {
      id: id,
      msgId: msgId,
      status: status,
      resCode: resCode,
      err: err,
      errmsg: errmsg
    };
  } else {
    resObj = {
      id: id,
      msgId: msgId,
      status: status,
      resCode: resCode,
      data: data
    };
  }
  return resObj;
}

async function getListOfCategories(req, res) {
  const payload = { ...req.body.request };
  const requiredParams = jsonConstants.requiredParams[req.route.path];
  const isRequiredParamsMissing = await util.checkRequiredParameters(req, res, requiredParams, payload);
  if (isRequiredParamsMissing) {
    const cids = payload.cids;
    let allCategories = [];
    for (let i = 0; i < cids.length; i++) {
      try {
        const url = constants.category + '/' + cids[i];
        const data = await util.getResponseData(req, url, categoryList, null, constants.get);
        allCategories.push(data);
        if (i === (cids.length - 1)) {
          const responseObj = await util.responseData(req, res, allCategories, null);
          res.send(responseObj);
        }
      } catch (error) {
        console.log({ message: `Error while call the api` });
        console.log({ message: `Error message:  ${error.message}` });
        util.generateError(req, res, error.message, 404);
      }
    }
  }
}

async function getTagsRelatedTopics(req, res) {
  const payload = { ...req.body.request };
  const requiredParams = jsonConstants.requiredParams[req.route.path];
  const isRequiredParamsMissing = await util.checkRequiredParameters(req, res, requiredParams, payload);
  if (isRequiredParamsMissing) {
    try {
      const url = constants.tags + '/' + payload.tag;
      const data = await util.getResponseData(req, url, tagsList, null, constants.get);
      const releatedTopics = data.topics.filter(topic => payload.cid.includes(String(topic.cid)));
      const responseObj = await util.responseData(req, res, releatedTopics, null);
      res.send(responseObj);
    } catch (error) {
      console.log({ message: `Error while call the api` });
      console.log({ message: `Error message:  ${error.message}` });
      util.generateError(req, res, error.message, 500);
    }
  }
}

async function getContextBasedTags(req, res) {
  const payload = { ...req.body.request };
  let resObj = {
    id: constants[contextBasesTags],
    status: constants.statusSuccess,
    resCode: constants.resCode,
    data: null
  };
  if (payload) {
    const cids = payload.cids;
    let allTopics = [],
      allTags = [];

    for (let i = 0; i < cids.length; i++) {
      try {
        const url = constants.category + '/' + cids[i];
        const data = await util.getResponseData(req, url, contextBasesTags, null, constants.get);
        allTopics.push(...data.topics);
        if (i === cids.length - 1) {
          allTopics.filter((val, inx) => {
            if (val.tags.length) {
              allTags.push(...val.tags);
            }
          });

          const tagData = new Map(
            allTags.map(tag => [tag.value, { ...tag, score: 0 }])
          );
          for (const { value } of allTags) tagData.get(value).score++;
          const result = Array.from(tagData.values());

          resObj.data = result;
          res.send(responseMessage.successResponse(resObj));
        }
      } catch (error) {
        console.log({ message: `Error message:  ${error.message}` });
        res.statusCode = 404;
        resObj.status = constants.failed;
        resObj.resCode = constants.errorResCode;
        resObj.err = error.status;
        resObj.errmsg = error.message;
        res.send(responseMessage.errorResponse(resObj));
      }
    }
  }
}

async function getUserIds(req, res) {
  const payload = { ...req.body.request };
  const requiredParams = jsonConstants.requiredParams[req.route.path];
  const isRequiredParamsMissing = await util.checkRequiredParameters(req, res, requiredParams, payload);
  if (isRequiredParamsMissing) {
    try {
      const userIds = await util.userDetailsByoAuth(payload.sbIdentifiers);
      const data = { userIds: userIds };
      const responseObj = await util.responseData(req, res, data, null);
      res.send(responseObj);
    } catch (error) {
      util.generateError(req, res, error.message, 500);
    }
  }
}

async function relatedDiscussions(req, res) {
  const reqPayload = { ...req.body.category };
  const requiredParams = jsonConstants.requiredParams[req.route.path];
  const isRequiredParamsMissing = await util.checkRequiredParameters(req, res, requiredParams, reqPayload);
  if (isRequiredParamsMissing) {
    const payload = reqPayload;
    if (!_.isEmpty(payload.groups) && !_.isEmpty(payload.privileges)) {
      util.generateError(req, res, jsonConstants.forumStrings.privilegeGroupErrorMsg, 400, jsonConstants.forumStrings.payloadError);
    } else {
      let finalResponse = {};
      const body = {
        parentCid: payload.pid || 0,
        name: payload.name || constants.defaultCategory,
        description: _.get(payload, 'description')
      };
      const cdata = await Categories.create(body);

      if (cdata) {
        const context = payload.context;
        if (!_.isEmpty(context)) {
          finalResponse['forums'] = await addContext(context, cdata.cid);
          if (payload.privileges && !_.isEmpty(payload.privileges.copyFromCategory)) {
            const result = await Categories.copyPrivilegesFrom(payload.privileges.copyFromCategory, cdata.cid);
            const members = await util.getMembers(cdata.cid);
            finalResponse['groups'] = members;
            try {
              const subCategory = await checkSubcategories(payload.subcategories, cdata.cid);
              finalResponse.subcategories = subCategory;
              const responseObj = await util.responseData(req, res, finalResponse, null);
              res.send(responseObj);
            } catch (error) {
              util.generateError(req, res, error.message, 500);
            }
          } else if (!_.isEmpty(payload.groups)) {
            try {
              const addPrivileges = await util.groupsAndPrivileges(cdata.cid, payload.groups);
              const members = await util.getMembers(cdata.cid);
              finalResponse['groups'] = members;
              const subCategory = await checkSubcategories(payload.subcategories, cdata.cid);
              finalResponse.subcategories = subCategory;
              const responseObj = await util.responseData(req, res, finalResponse, null);
              res.send(responseObj);
            } catch (error) {
              util.generateError(req, res, error.message, 500);
            }
          } else {
            const responseObj = await util.responseData(req, res, finalResponse, null);
            res.send(responseObj);
          }
        } else {
          util.generateError(req, res, jsonConstants.forumStrings.contextError, 400);
        }
      } else {
        console.log('category creation failed');
        console.log('Error is', cdata.message);
        util.generateError(req, res, jsonConstants.forumStrings.categoryError, 500);
      }
    }
  }
}

async function addContext(context, cid) {
  const forumIds = [];
  return new Promise((resolve, reject) => {
    context.forEach(async (contextData, i) => {
      const addPropertyInCategory = await Categories.setCategoryField(cid, 'contextId', contextData.identifier);
      let mapObj = {
        sbIdentifier: contextData.identifier,
        sbType: contextData.type,
        cid: cid
      };
      client.save(mapObj);
      const mappedCids = await client.getContext(contextData);
      const listOfCids = mappedCids.length > 0 ? mappedCids.map(forum => forum.cid) : [];

      const mapResObj = {
        "sbType": contextData.type,
        "sbIdentifier": contextData.identifier,
        "newCid": cid,
        "cids": listOfCids
      };
      forumIds.push(mapResObj);
      if (i === (context.length - 1)) {
        resolve(forumIds);
      }
    });
  });
}

async function checkSubcategories(subcategories, cid) {
  console.log('add checkSubcategories');
  return new Promise(async (resolve, reject) => {
    if (!_.isEmpty(subcategories)) {
      try {
        const addingSubcategory = await addSubcategories(subcategories, cid);
        resolve(addingSubcategory);
      } catch (error) {
        reject(error);
      }
    } else {
      resolve([]);
    }
  });
}

async function addSubcategories(subCategories, pid) {
  let subCategoryResponse = [];
  return new Promise(async (resolve, reject) => {
    for (let i = 0; i < subCategories.length; i++) {
      let privilegesError;
      if (!_.isEmpty(subCategories[i].groups) && !_.isEmpty(subCategories[i].privileges)) {
        privilegesError = new Error(jsonConstants.forumStrings.subCategoryError);
        privilegesError.statusCode = 400;
        reject(privilegesError);
      } else {
        const categoryObj = {
          name: subCategories[i].name,
          parentCid: pid,
          description: _.get(subCategories[i], 'description')
        };

        const creatSubCategory = await Categories.create(categoryObj);

        const data = {
          name: creatSubCategory.name,
          cid: creatSubCategory.cid,
          pid: pid,
          groups: []
        };

        if (!_.isEmpty(subCategories[i].context)) {
          subCategories[i].context.forEach(async (context) => {
            const addPropertyInCategory = await Categories.setCategoryField(creatSubCategory.cid, 'contextId', context.identifier);
            const contextObj = {
              "sbType": context.type,
              "sbIdentifier": context.identifier,
              "cid": creatSubCategory.cid
            };
            client.save(contextObj);
          });
        }

        if (subCategories[i].privileges && subCategories[i].privileges.copyFromParent) {
          await Categories.copyPrivilegesFrom(pid, creatSubCategory.cid);
        } else if (!_.isEmpty(subCategories[i].groups)) {
          await util.groupsAndPrivileges(creatSubCategory.cid, subCategories[i].groups);
        }
        data['groups'] = await util.getMembers(creatSubCategory.cid);
        if (!_.isEmpty(data.groups)) {
          subCategoryResponse.push(data);
          if (i === (subCategories.length - 1)) {
            resolve(subCategoryResponse);
          }
        }
      }
    }
  });
}

async function copyPrivilegeData(req, res) {
  const payload = { ...req.body.request };
  const requiredParams = jsonConstants.requiredParams[req.route.path];
  const isRequiredParamsMissing = await util.checkRequiredParameters(req, res, requiredParams, payload);
  if (isRequiredParamsMissing) {
    await Categories.copyPrivilegesFrom(payload.pid, payload.cid);
    const result = await util.responseData(req, res, _.get(jsonConstants.forumStrings, 'privilegesCopy'), null);
    res.send(result);
  }
}

async function addUsers(req, res) {
  const payload = { ...req.body.request };
  const requiredParams = jsonConstants.requiredParams[req.route.path];
  const isRequiredParamsMissing = await util.checkRequiredParameters(req, res, requiredParams, payload);
  if (isRequiredParamsMissing) {
    const groupsList = payload.groups;
    const sunbirdUsers = payload.members;
    sunbirdUsers.forEach(async (user, index) => {
      let nodebbUid = await db.getObjectField(constants.name + 'Id:uid', user.sbUid);
      if (!nodebbUid) {
        try {
          nodebbUid = await util.createNewUser(user);
        } catch (error) {
          util.generateError(req, res, error.message, 400);
          return false;
        }
      }
      await util.addUsersInGroup(groupsList, nodebbUid);
      if (index === (sunbirdUsers.length - 1)) {
        const userList = await util.getMembers(null, groupsList);
        const result = { groups: userList };
        const responseObj = await util.responseData(req, res, result, null);
        res.send(responseObj);
      }
    });
  }
}

async function getContextUserGroups(req, res) {
  const payload = { ...req.body.request };
  const requiredParams = jsonConstants.requiredParams[req.route.path];
  const isRequiredParamsMissing = await util.checkRequiredParameters(req, res, requiredParams, payload);
  if (isRequiredParamsMissing) {
    const groups = payload.groups || [];
    const cid = payload.cid;
    const userList = await util.getMembers(cid, groups);
    const result = { groups: userList };
    const responseObj = await util.responseData(req, res, result, null);
    res.send(responseObj);
  }
}

async function getContextGroupPriveleges(req, res) {
  const payload = { ...req.body.request };
  const requiredParams = jsonConstants.requiredParams[req.route.path];
  const isRequiredParamsMissing = await util.checkRequiredParameters(req, res, requiredParams, payload);
  if (isRequiredParamsMissing) {
    const groups = payload.groups;
    const cid = req.params.cid;
    const isCidExist = await Categories.exists(cid);
    let groupsData = [];
    if (isCidExist) {
      const groupsList = await privileges.categories.list(cid);
      groups.forEach(async (group, index) => {
        const cgroup = groupsList.groups.filter(data => data.name.toLowerCase() === group.toLowerCase());
        if (cgroup && cgroup.length > 0) {
          groupsData.push(cgroup[0]);
        } else {
          const noGroup = {
            name: group,
            message: (constants.noGroupAddedMsg.replace('${group}', group)).replace('${cid}', cid)
          };
          groupsData.push(noGroup);
        }
        if (index === (groups.length - 1)) {
          const result = {
            groups: groupsData
          };
          const responseObj = await util.responseData(req, res, result, null);
          res.send(responseObj);
        }
      });
    } else {
      util.generateError(req, res, constants.incorrectCid.replace('${cid}', cid), 400);
    }
  }
}

async function getUsersDetails(req, res) {
  const payload = _.get(req.body, 'request');
  let userList = [];

  if (payload.uid) {
    const uids = Array.isArray(payload.uid) ? payload.uid : [payload.uid];
    userList = await Users.getUsersFields(uids, []);
  }

  if (payload.uids && Array.isArray(payload.uids)) {
    userList = await Users.getUsersFields(payload.uids, []);
  }

  if (payload.userslug) {
    const uid = await Users.getUidByUserslug(payload.userslug);
    userList = await Users.getUsersFields([uid], []);
  }

  if (userList.length == 0) {
    util.generateError(req, res, jsonConstants.forumStrings.payloadError, 400);
    return;
  }

  const responseObj = await util.responseData(req, res, userList, null);
  res.send(responseObj);
}

async function createForumContext(req, res) {
  const payload = { ...req.body.request };
  const requiredParams = jsonConstants.requiredParams[req.route.path];
  const isRequiredParamsMissing = await util.checkRequiredParameters(req, res, requiredParams, payload);
  if (isRequiredParamsMissing) {
    try {
      const data = await client.save(payload);
      const responseObj = await util.responseData(req, res, data, null);
      res.send(responseObj);
    } catch (error) {
      util.generateError(req, res, error.message, 500);
    }
  }
}

async function getForumContext(req, res) {
  const payload = { ...req.body.request };
  const requiredParams = jsonConstants.requiredParams[req.route.path];
  const isRequiredParamsMissing = await util.checkRequiredParameters(req, res, requiredParams, payload);
  if (isRequiredParamsMissing) {
    try {
      const getData = await client.getContext(payload);
      const responseObj = await util.responseData(req, res, getData, null);
      res.send(responseObj);
    } catch (error) {
      util.generateError(req, res, error.message, 500);
    }
  }
}

async function removeForumContext(req, res) {
  const payload = { ...req.body.request };
  const requiredParams = jsonConstants.requiredParams[req.route.path];
  const isRequiredParamsMissing = await util.checkRequiredParameters(req, res, requiredParams, payload);
  if (isRequiredParamsMissing) {
    try {
      const data = await client.removeContext(payload);
      if (data === 1) {
        const responseObj = await util.responseData(req, res, jsonConstants.forumStrings.removeForumSuccessMsg, null);
        res.send(responseObj);
      } else {
        util.generateError(req, res, jsonConstants.forumStrings.removeForumFailMsg, 400);
      }
    } catch (error) {
      util.generateError(req, res, error.message, 500);
    }
  }
}

async function updateUserProfileData(req, res) {
  const userData = { ...req.body.request };
  const requiredParams = jsonConstants.requiredParams[req.route.path];
  const isPayloadCorrect = await util.checkRequiredParameters(req, res, requiredParams, userData);
  if (isPayloadCorrect) {
    try {
      const userIds = await util.userDetailsByoAuth([userData.sbIdentifier]);
      const uid = _.get(userIds[0], 'nodebbUid');
      const isUserExist = await Users.exists(uid);
      if (isUserExist) {
        userData['uid'] = uid;
        const userFields = jsonConstants.forumStrings.userFields;
        const oldUserData = await Users.getUserFields(uid, userFields);
        const result = await util.updateNodebbUserData(userData, oldUserData, userFields);
        const responseObj = await util.responseData(req, res, jsonConstants.forumStrings.userDataSave, null);
        res.send(responseObj);
      } else {
        util.generateError(req, res, jsonConstants.forumStrings.userDataError, 400);
      }
    } catch (error) {
      util.generateError(req, res, error.message, 500);
    }
  }
}

// FIXED: Main plugin initialization - changed from Plugin.init to plugin.init
const plugin = {};

plugin.init = async function (params) {
  try {
    console.log('[nodebb-plugin-sunbird-api] Initializing plugin...');
    var router = params.router;

    if (!router) {
      throw new Error('Router parameter is required for plugin initialization');
    }

    // FIXED: Better database type detection with fallback
    const dbType = _.get(configData, 'database') || process.env.database || 'redis';
    console.log('[nodebb-plugin-sunbird-api] Database type:', dbType);

    if (!dbType) {
      console.error('[nodebb-plugin-sunbird-api] ERROR: No database type in config.json');
      throw new Error('No database type in config.json');
    }

    // Initialize database client with better error handling
    try {
      client = require(`./database/${dbType}`);
      if (client && typeof client.connect === 'function') {
        await client.connect(configData);
        console.log('[nodebb-plugin-sunbird-api] Database connected successfully');
      } else {
        console.log('[nodebb-plugin-sunbird-api] Database client loaded (no connect method)');
      }
    } catch (dbError) {
      console.error('[nodebb-plugin-sunbird-api] Database connection failed:', dbError.message);
      console.log('[nodebb-plugin-sunbird-api] Continuing without database client...');
      // Don't throw error - continue with route registration
    }

    // FIXED: Register health check endpoints with /discussions/api prefix for consistency
    router.get('/discussions/api/forum/health', (req, res) => {
      res.json({
        status: 'ok',
        plugin: 'nodebb-plugin-sunbird-api',
        version: '2.0.5',
        timestamp: new Date().toISOString(),
        nodebbVersion: process.env.npm_package_version || 'unknown',
        database: dbType,
        routes: [
          '/discussions/api/forum/health',
          '/discussions/api/forum/routes',
          '/discussions/api/forum/v1/create',
          '/discussions/api/forum/v1/read',
          '/discussions/api/forum/v2/create',
          '/discussions/api/forum/v2/read',
          '/discussions/api/forum/v3/create'
        ]
      });
    });

    router.get('/discussions/api/forum/routes', (req, res) => {
      res.json({
        available_routes: [
          'GET /discussions/api/forum/health - Health check',
          'GET /discussions/api/forum/routes - List all routes',
          'POST /discussions/api/forum/v1/create - Create forum (v1)',
          'POST /discussions/api/forum/v1/read - Read forum (v1)',
          'POST /discussions/api/forum/v2/create - Create forum (v2)',
          'POST /discussions/api/forum/v2/read - Read forum (v2)',
          'POST /discussions/api/forum/v3/create - Create forum (v3)',
          'POST /discussions/api/topic/v1/create - Create topic',
          'POST /discussions/api/topic/v1/reply - Reply to topic'
        ]
      });
    });

    // FIXED: Register all routes with /discussions/api/forum prefix for consistency
    router.post(createSBForum, createForumContext);
    router.post(getSBForum, getForumContext);
    router.post(removeSBForum, removeForumContext);
    
    router.post(categoryList, getListOfCategories);
    router.post(tagsList, getTagsRelatedTopics);
    router.post(contextBasesTags, getContextBasedTags);
    
    router.post(createRelatedDiscussions, relatedDiscussions);
    router.post('/discussions/api/forum/v3/create', relatedDiscussions);
    
    router.post(copyPrivilages, copyPrivilegeData);
    router.post(getUids, getUserIds);
    router.post(addUserIntoGroup, addUsers);
    router.post(listOfGroupUsers, getContextUserGroups);
    router.post(groupsPriveleges, getContextGroupPriveleges);
    router.post(usersList, getUsersDetails);
    router.post(updateUserProfile, updateUserProfileData);

    // Protected routes with middleware
    router.post(createForumURL, apiMiddleware.requireUser, apiMiddleware.requireAdmin, createForumAPI);
    router.post(allTopicsByCategoryURL, apiMiddleware.requireUser, apiMiddleware.requireAdmin, allTopicsByCategory);
    router.post(allPostsByTopicURL, apiMiddleware.requireUser, apiMiddleware.requireAdmin, allPostsByTopic);
    router.post(getForumURL, apiMiddleware.requireUser, apiMiddleware.requireAdmin, getForumAPI);
    router.post(createTenantURL, apiMiddleware.requireUser, apiMiddleware.requireAdmin, setupOrgAPI);
    router.post(createSectionURL, apiMiddleware.requireUser, apiMiddleware.requireAdmin, addSectionURL);
    router.put(banUserURL, apiMiddleware.requireUser, apiMiddleware.requireAdmin, banUserAPI);
    router.delete(unbanUserURL, apiMiddleware.requireUser, apiMiddleware.requireAdmin, unbanUserAPI);
    router.post(createTopicURL, apiMiddleware.requireUser, apiMiddleware.requireAdmin, createTopicAPI);
    router.post(createCatwithSubcatURL, createCatwithSubcat);
    router.post(replyTopicURL, apiMiddleware.requireUser, apiMiddleware.requireAdmin, replyTopicAPI);
    router.post(voteURL, apiMiddleware.requireUser, apiMiddleware.requireAdmin, voteURLAPI);
    router.delete(deletePostURL, apiMiddleware.requireUser, apiMiddleware.requireAdmin, deletePostAPI);
    router.delete(deleteTopicURL, apiMiddleware.requireUser, apiMiddleware.requireAdmin, deleteTopicAPI);
    router.delete(purgeTopicURL, apiMiddleware.requireUser, apiMiddleware.requireAdmin, purgeTopicAPI);
    router.delete(purgePostURL, apiMiddleware.requireUser, apiMiddleware.requireAdmin, purgePostAPI);

    console.log('[nodebb-plugin-sunbird-api] Plugin initialized successfully');
    console.log('[nodebb-plugin-sunbird-api] Routes registered:');
    console.log('[nodebb-plugin-sunbird-api] - Health check: /discussions/api/forum/health');
    console.log('[nodebb-plugin-sunbird-api] - Forum create: /discussions/api/forum/v1/create');
    console.log('[nodebb-plugin-sunbird-api] - Forum read: /discussions/api/forum/v1/read');
    
    return {
      success: true,
      routesRegistered: 'All routes registered with /discussions/api prefix'
    };
  }
  catch (error) {
    console.error('[nodebb-plugin-sunbird-api] INITIALIZATION ERROR:', error);
    throw new Error(`Plugin initialization failed: ${error.message}`);
  }
};

module.exports = plugin;