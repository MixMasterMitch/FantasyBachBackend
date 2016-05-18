'use strict';

var _assign = require('lodash/assign');
var _each = require('lodash/each');
var _extend = require('lodash/extend');
var _map = require('lodash/map');
var AWS = require('aws-sdk');
var dynamodbDoc = new AWS.DynamoDB.DocumentClient();

// Export For Lambda Handler
module.exports.handler = function(userId, pathParams, queryParams, body, done) {
    return action(pathParams.seasonId, userId, queryParams.id, queryParams.ids, done);
};

var getLeagues = function(seasonId, leagueIds, done) {
    if (!leagueIds || leagueIds.length <= 0) { return done(null, []); }
    var params = {
        RequestItems : {}
    };
    params.RequestItems[process.env.LEAGUES_TABLE] = {
        ProjectionExpression : '#id, #adminId, #memberIds, #name',
        ExpressionAttributeNames : {
            '#id' : 'id',
            '#adminId' : 'adminId',
            '#memberIds' : 'memberIds',
            '#name' : 'name'
        },
        Keys : _map(leagueIds, function(leagueId) {
            return {
                id : leagueId,
                seasonId : seasonId
            }
        })
    };
    return dynamodbDoc.batchGet(params, function(err, data) {
        if (err) { return done(err); }
        done(null, data.Responses[process.env.LEAGUES_TABLE]);
    });
};

var getTopUsers = function(seasonId, callback) {
    return dynamodbDoc.query({
        TableName : process.env.TOP_USERS_TABLE,
        KeyConditionExpression: 'seasonId = :seasonId',
        ExpressionAttributeValues: {
            ':seasonId': seasonId
        }
    }, function(err, data) {
        if (err) { return callback(err); }
        callback(null, data.Items);
    });
};

var action = function(seasonId, userId, id, ids, done) {
    var projectionParams = {
        ProjectionExpression : '#id, #nickname, #profilePicture, #picks.#seasonId, #scores.#seasonId',
        ExpressionAttributeNames : {
            '#id' : 'id',
            '#nickname' : 'nickname',
            '#profilePicture' : 'profilePicture',
            '#picks' : 'picks',
            '#scores' : 'scores',
            '#seasonId' : seasonId
        }
    };

    if (ids) {
        ids = ids.split(',');
        var params = {
            RequestItems : {}
        };
        params.RequestItems[process.env.USERS_TABLE] = _assign(projectionParams, {
            Keys : _map(ids, function(id) {
                return {
                    id : id
                }
            })
        });
        return dynamodbDoc.batchGet(params, function(err, data) {
            if (err) { return done(err); }
            var users = data.Responses[process.env.USERS_TABLE];
            _each(users, function(user) {
                if (!user.picks || !user.scores) { return; }
                user.picks = user.picks[seasonId];
                user.scores = user.scores[seasonId];
            });
            done(null, users);
        });
    }
    if (!id) {
        id = userId;
        projectionParams.ProjectionExpression += ', #email, #name, #facebookId, #leagues.#seasonId';
        _extend(projectionParams.ExpressionAttributeNames, {
            '#email' : 'email',
            '#name' : 'name',
            '#facebookId' : 'facebookId',
            '#leagues' : 'leagues'
        });
    }
    return dynamodbDoc.get(_assign(projectionParams, {
        TableName : process.env.USERS_TABLE,
        Key : {
            id : id
        }
    }), function(err, data) {
        if (err) { return done(err); }
        if (data.Item.picks) {
            data.Item.picks = data.Item.picks[seasonId];
        }
        if (data.Item.scores) {
            data.Item.scores = data.Item.scores[seasonId];
        }
        if (data.Item.leagues) {
            return getLeagues(seasonId, data.Item.leagues[seasonId], function(err, leagues) {
                if (err) { return done(err); }
                getTopUsers(seasonId, function(err, topUsers) {
                    if (err) { return done(err); }
                    leagues.unshift({
                        name : 'global leaderboard',
                        id : 'global',
                        memberIds : _map(topUsers, 'id')
                    });
                    data.Item.leagues = leagues;
                    done(null, data.Item);
                });
            });
        }
        done(null, data.Item);
    });
};

