const redisConnection = require.main.require('./src/database/redis/connection');
const _ = require('lodash');
const { getLogger } = require('../lib/logger');

let redisClient;
const logger = getLogger('nodebb-plugin-sunbird-api').createChildLogger('redis-db');

const redis = {
    connect: async (connectionObj) => {
        try {
            logger.info('Attempting Redis connection', { 
                host: connectionObj.redis?.host,
                port: connectionObj.redis?.port,
                database: connectionObj.redis?.database 
            });
            
            console.log('Redis db connection', JSON.stringify(connectionObj));
            connectionObj.redis.database = parseInt(_.get(connectionObj, 'redis.database'));
            
            const connection = await redisConnection.connect(connectionObj.redis);
            redisClient = {'client' : connection};
            
            require.main.require('./src/database/redis/hash')(redisClient);
            require.main.require('./src/database/redis/main')(redisClient);
            
            logger.info('Redis connection successful', {
                database: connectionObj.redis.database,
                connectionTime: new Date().toISOString()
            });
            
            console.log('Redis db connected.')
        } catch (error) {
            logger.error('Redis connection failed', { 
                error: error.message,
                stack: error.stack,
                config: connectionObj.redis 
            });
            throw error;
        }
    },
    
    save: async (context) => {
        try {
            logger.debug('Saving context to Redis', { 
                sbType: context.sbType,
                sbIdentifier: context.sbIdentifier,
                cid: context.cid 
            });
            
            const key = `sbCategory:${context.sbType}:${context.sbIdentifier}`;
            context.cid = Array.isArray(context.cid) ? context.cid[0] : context.cid;
            
            const setData = await redisClient.setObject(key , context);
            const data = await redisClient.getObject(key);
            
            logger.debug('Context saved successfully', { key, data });
            return data;
        } catch(error) {
            logger.error('Failed to save context to Redis', { 
                error: error.message,
                context 
            });
            throw error
        }
    },
    
    getContext: async (context) => {
        try {
            const id = Array.isArray(context.identifier) ? context.identifier[0] : context.identifier;
            const key = `sbCategory:${context.type}:${id}`;
            
            logger.debug('Getting context from Redis', { key });
            
            const nodebbData = await redisClient.getObject(key);
            
            logger.debug('Context retrieved', { 
                key, 
                found: !!nodebbData,
                data: nodebbData ? JSON.stringify(nodebbData) : null 
            });
            
            console.log("context_key: ", key, " Nodebb returns: ", nodebbData ? JSON.stringify(nodebbData) : nodebbData);
            return nodebbData ? Array.of(nodebbData) : [];
        } catch(error) {
            logger.error('Failed to get context from Redis', { 
                error: error.message,
                context 
            });
            throw error;
        }
    },
    
    removeContext: async (context) => {
        try {
            const id = Array.isArray(context.sbIdentifier) ? context.sbIdentifier[0] : context.sbIdentifier;
            const key = `sbCategory:${context.sbType}:${id}`;
            
            logger.debug('Removing context from Redis', { key });
            
            const deleteForum = await redisClient.delete(key);
            redisClient.objectCache.del(key);
            
            logger.info('Context removed successfully', { key });
            console.log("context_remove_key: ", key);
            return 1;
        } catch(error) {
            logger.error('Failed to remove context from Redis', { 
                error: error.message,
                context 
            });
            throw error;
        }
    } 
}

module.exports = redis;