/**
 * This js file contains list of reusable methods, and can be used any where.
 *  you can add any reusable methods in the below json object.
 */

// parent modules
const privileges = require.main.require('./src/privileges');
const Users = require.main.require('./src/user')
const Groups = require.main.require('./src/groups')
const db = require.main.require('./src/database')
const oidcPlugin = require.main.require('./node_modules/nodebb-plugin-sunbird-oidc/library.js');
const axios = require('axios');

const responseMessage = require('../responseHandler');
const constants = require('./constants');
const _ = require('lodash');

const services = {
    checkRequiredParameters: async function (req, res, paramerts, payload) {
        const payloadKeys = Object.keys(payload);
        const missingKeys = paramerts.filter(key => {
            const data = payload[key.name];
            if (payloadKeys.includes(key.name)) {
                if (key.type === 'string') {
                    return _.isEmpty(_.trim(data));
                } else if (key.type === 'array') {
                    return Array.isArray(data) ? (_.isEmpty(data) || data.length === 0) : true;
                } else if (key.type === 'number') {
                    return typeof data === key.type ? data <= 0 : true;
                } else if (key.type === 'any') {
                    return data ? false : true;
                } else {
                    return _.isEmpty(data);
                }
            }
            return true;
        });
        console.log("Missig parameters are:", missingKeys)
        if (_.isEmpty(missingKeys)) {
            return true
        } else {
            logMissingParametersError(req, res, missingKeys)
            return false;
        }
    },
    responseData: async function (req, res, data, error) {
        const resObj = {
            id: req.originalUrl.split('/').join('.'),
            status: constants.forumStrings.statusSuccess,
            resCode: constants.forumStrings.resCode,
            data: null
        };
        if (error) {
            res.statusCode = error.statusCode || 500;
            resObj.status = constants.forumStrings.statusFailed;
            resObj.resCode = error.errorResCode || constants.forumStrings.serverError;
            resObj.err = error.statusCode || 500;
            resObj.errmsg = error.message;
            return responseMessage.errorResponse(resObj);
        }
        resObj.data = data.result || data;
        return responseMessage.successResponse(resObj);
    },
    generateError: async function (req, res, message, code, errorType) {
        const error = new Error(message);
        error.statusCode = code;
        error.errorResCode = errorType || '';
        const result = await services.responseData(req, res, null, error);
        res.send(result);
    },
    userDetailsByoAuth: async function (sbIds) {
        const result = await getUidByOAuthId(sbIds);
        return result;
    },
    getMembers: async (cid, groups = []) => {
        let categoryGroups = [];
        if (cid) {
            const groupsList = await privileges.categories.list(cid);
            categoryGroups = groupsList.groups.map(group => group.name);

        }
        const allGroups = Array.from(new Set(categoryGroups.concat(groups)));
        const groupsData = await Groups.getMembersOfGroups(allGroups);
        let userList = [];
        return new Promise((resolve, reject) => {
            if (!_.isEmpty(groupsData)) {
                groupsData.forEach(async (groupUsers, i) => {
                    let data = {
                        name: allGroups[i]
                    };
                    if (groupUsers && groupUsers.length > 0) {
                        data['members'] = await getUserDetails(groupUsers);
                    } else {
                        data['members'] = [];
                    }
                    userList.push(data);
                    if (i === (groupsData.length - 1)) {
                        resolve(userList);
                    }
                });
            } else {
                resolve(userList)
            }
        })
    },
    userGroupDetails: async function (groups) {
        const result = await getUserDetails(groups);
        return result;
    },
    groupsAndPrivileges: async function (cid, groups) {
        return new Promise(async (resolve, reject) => {
            for (let i = 0; i < groups.length; i++) {
                const groupData = groups[i];
                const isGroupExists = await Groups.exists(groupData.name);
                if (!isGroupExists) {
                    Groups.create({
                        name: groupData.name
                    });
                }
                const addGroupAndPrivileges = await privileges.categories.give(groupData.privileges, cid, groupData.name)
                try {
                    const nodebbUids = await getUidByOAuthId(groupData.sbUids);
                    for (let j = 0; j < nodebbUids.length; j++) {
                        const groupSlug = await Groups.getGroupField(groupData.name, 'slug');
                        const addUserIntoGroups = await Groups.join(groupData.name, nodebbUids[j]['nodebbUid']);
                    }
                } catch (error) {
                    console.log("error")
                    console.log(error)
                    reject(error);
                }
                if (i === (groups.length - 1)) {
                    resolve({ code: 'ok' })
                }
            }
        })
    },
    getResponseData: async function (req, url, upstremUrl, payload, method) {
        try {
            console.log('Preparing request options')
            console.log('original url', req.originalUrl)
            const urlData = req.originalUrl.split(upstremUrl).join('').split('?')
            const apiSlug = urlData[0];
            const query = !_.isEmpty(urlData[1]) ? `?${urlData[1]}` : `?_uid=${req.body['_uid']}`;
            console.log('apiSlug', apiSlug)
            const baseUrl = `${constants.forumStrings.http_protocal}://${req.get('host')}${apiSlug}${constants.forumStrings.apiPrefix}`
            const options = {
                url: baseUrl + url + query,
                method: method,
                headers: {
                    "Authorization": req.headers['authorization']
                }
            };
            if (payload) {
                options.data = payload;
            }
            console.log(options)
            const result = await axios(options);
            return result.data;
        } catch (error) {
            return error;
        }
    },
    createNewUser: async function (user) {
        return new Promise((resolve, reject) => {
            if (user.sbUserName && user.sbUid) {
                const settings = constants.forumStrings.pluginSettings.getWrapper();
                var email = user.sbUserName + '@' + settings.emailDomain;
                const userPayload = {
                    username: user.sbUserName,
                    oAuthid: user.sbUid,
                    email: email,
                    rolesEnabled: settings.rolesClaim && settings.rolesClaim.length !== 0,
                    isAdmin: false,
                }
                console.log(oidcPlugin)
                oidcPlugin.login(userPayload, (err, user) => {
                    if (err && err === 'UserExists') {
                        resolve(user.uid);
                        return;
                    } else if (user) {
                        resolve(user.uid);
                    } else {
                        reject(err);
                    }
                });
            } else {
                const errorMessage = { message: constants.forumStrings.emptyDataForGroups };
                reject(errorMessage)
            }
        })
    },
    addUsersInGroup: async function (groups, uid) {
        console.log(groups, uid)
        return new Promise((resolve, reject) => {
            groups.forEach(async (group, i) => {
                const isGroupExists = await Groups.exists(group);
                if (!isGroupExists) {
                    Groups.create({
                        name: group
                    });
                }
                const joinIntoGroup = await Groups.join([group], uid);
                if (i === (groups.length - 1)) {
                    resolve({ code: "ok" })
                }
            })
        })
    },
    updateNodebbUserData: async function (userData, oldUserData, userFields) {
        return new Promise((resolve, reject) => {
            userFields.forEach(async (field, index) => {
                try {
                    await db.sortedSetRemove(field + ':uid', _.get(oldUserData, field));
                    const value = _.get(userData, field);
                    await Users.setUserField(_.get(userData, 'uid'), field, value);
                    if (value) {
                        await db.sortedSetAdd(field + ':uid', _.get(userData, 'uid'), value);
                    }
                    if (index === (userFields.length - 1)) {
                        resolve();
                    }
                } catch (error) {
                    reject(error);
                }
            });
        })
    }
}

async function getUidByOAuthId(sbIds) {
    return new Promise((resolve, reject) => {
        let userIds = [];
        try {
            sbIds.forEach(async (sbId, index) => {
                const userId = await db.getObjectField(constants.forumStrings.oAuthKey + 'Id:uid', sbId);
                if (userId === null) {
                    const error = new Error("uid not found");
                    error.statusCode = 400;
                    reject(error);
                }
                userIds.push({ nodebbUid: userId, sbUid: sbId });
                if (index === (sbIds.length - 1)) {
                    resolve(userIds)
                }
            })
        } catch (error) {
            error.statusCode = 500;
            reject(error);
        }
    })
}

async function getUserDetails(groupUsers) {
    const users = [];
    return new Promise((resolve, reject) => {
        groupUsers.forEach(async (uid, i) => {
            // fetching the user details bu passing uid
            const userDetails = await Users.getUserData(uid)
            const data = {
                "uid": userDetails.uid,
                "userName": userDetails.username,
                "sbUid": userDetails['sunbird-oidcId']
            }
            users.push(data)
            if (i === (groupUsers.length - 1)) {
                resolve(users)
            }
        })
    })
}

async function logMissingParametersError(req, res, parameters) {
    let errorMessage;
    if (!_.isEmpty(parameters) && parameters.length === 1) {
        errorMessage = `${parameters[0].name}( ${parameters[0].type} ) is required paramater`;
    } else if (!_.isEmpty(parameters) && parameters.length === 2) {
        errorMessage = `${parameters[0].name}( ${parameters[0].type} ) and ${parameters[1].name} ( ${parameters[1].type} ) are required paramater`;
    } else {
        const lastIndex = parameters.length - 1;
        const lastParameter = parameters[lastIndex];
        parameters.splice(lastIndex, 1);
        console.log('delete params---------', parameters)
        const remainingParameters = parameters.map(prop => prop.name).join(', ');
        errorMessage = `${remainingParameters} and ${lastParameter.name} are required parameters`
    }
    const error = new Error(errorMessage);
    error.statusCode = 400;
    error.errorResCode = constants.forumStrings.payloadError;
    const data = await services.responseData(req, res, null, error);
    res.send(data);
}

module.exports = services;