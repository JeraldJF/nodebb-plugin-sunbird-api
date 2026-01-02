const mongoose = require('mongoose');
const { Schema } = mongoose;
const _ = require('lodash');
const { getLogger } = require('../lib/logger');

const logger = getLogger('nodebb-plugin-sunbird-api').createChildLogger('mongo-db');

const forumSchema = new Schema({ 
    sbType: String,
    cid: Number,
    sbIdentifier: String 
});

let client = {};

const mongo = {
  connect: (connectionObj) => {
    try {
      const mongodbConnectionUrl = `mongodb://${_.get(connectionObj, 'mongo.host')}:${_.get(connectionObj, 'mongo.port')}/${_.get(connectionObj,'mongo.database')}`;
      
      logger.info('Attempting MongoDB connection', {
        host: _.get(connectionObj, 'mongo.host'),
        port: _.get(connectionObj, 'mongo.port'),
        database: _.get(connectionObj,'mongo.database'),
        url: mongodbConnectionUrl
      });
      
      mongoose.connect(mongodbConnectionUrl);
      
      console.log('SB config Json: ', connectionObj);
      console.log('SB Mongo URL: ', mongodbConnectionUrl);
      
      client = mongoose.model('sbcategory', forumSchema);
      
      logger.info('MongoDB connection successful', {
        connectionTime: new Date().toISOString(),
        url: mongodbConnectionUrl
      });
    } catch (error) {
      logger.error('MongoDB connection failed', {
        error: error.message,
        stack: error.stack,
        config: connectionObj.mongo
      });
      throw error;
    }
  },
  
  save: async (context) => {
    try {
      logger.debug('Saving context to MongoDB', {
        sbType: context.sbType,
        sbIdentifier: context.sbIdentifier,
        cid: context.cid
      });
      
      context.cid = Array.isArray(context.cid) ? context.cid[0] : context.cid;
      const SbObj = new client(context);
      const mapResponse = await SbObj.save();
      
      logger.debug('Context saved successfully', { 
        id: mapResponse._id,
        context: mapResponse 
      });
      
      return mapResponse;
    } catch(error) {
      logger.error('Failed to save context to MongoDB', {
        error: error.message,
        context
      });
      throw error;
    }
  },
  
  getContext: async (context) => {
    try {
      logger.debug('Getting context from MongoDB', {
        identifier: context.identifier,
        type: context.type
      });
      
      const data = await client.find({
        sbIdentifier: context.identifier, 
        sbType: context.type
      });
      
      logger.debug('Context retrieved', {
        found: data.length,
        data: data
      });
      
      return data;
    } catch(error) {
      logger.error('Failed to get context from MongoDB', {
        error: error.message,
        context
      });
      throw error
    }
  },
  
  removeContext: async (context) => {
    try {
      logger.debug('Removing context from MongoDB', context);
      
      const data = await client.deleteOne(context);
      
      logger.info('Context removed successfully', {
        deletedCount: data.deletedCount,
        context
      });
      
      return data.deletedCount > 0 ? 1 : 0;
    } catch(error){
      logger.error('Failed to remove context from MongoDB', {
        error: error.message,
        context
      });
      throw error;
    }
  } 
}

module.exports = mongo;