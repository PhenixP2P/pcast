/**
 * Copyright 2018 PhenixP2P Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
define([
    'phenix-web-lodash-light',
    'phenix-web-assert',
    'phenix-web-observable',
    'phenix-web-disposable',
    '../AdminAPI',
    './PCastExpress',
    '../room/RoomService',
    './MemberSelector',
    '../room/Stream',
    '../room/room.json',
    '../room/member.json',
    '../room/stream.json',
    '../room/track.json'
], function(_, assert, observable, disposable, AdminAPI, PCastExpress, RoomService, MemberSelector, Stream, roomEnums, memberEnums, streamEnums, trackEnums) {
    'use strict';

    var defaultStreamWildcardTokenRefreshInterval = 300000;
    var defaultWildcardEnabled = true;

    function RoomExpress(options) {
        assert.isObject(options, 'options');

        if (options.pcastExpress) {
            assert.isObject(options.pcastExpress, 'options.pcastExpress');
        }

        this._pcastExpress = options.pcastExpress || new PCastExpress(options);
        this._shouldDisposeOfPCastExpress = !options.pcastExpress;
        this._roomServices = {};
        this._roomServicePublishers = {};
        this._activeRoomServices = [];
        this._membersSubscriptions = {};
        this._logger = this._pcastExpress.getPCast().getLogger();

        var that = this;

        this._pcastExpress.getPCastObservable().subscribe(function(pcast) {
            if (!pcast) {
                var roomServicesToCleanUp = _.assign({}, that._roomServices);

                _.forOwn(that._membersSubscriptions, function(membersSubscription) {
                    membersSubscription.dispose();
                });

                that._pcastExpress.waitForOnline(function() {
                    _.forOwn(roomServicesToCleanUp, function(roomService) {
                        roomService.stop();
                    });
                }, true);

                that._membersSubscriptions = {};
                that._roomServices = {};
                that._activeRoomServices = [];
            }
        });
    }

    RoomExpress.prototype.dispose = function dispose() {
        disposeOfRoomServices.call(this);

        if (this._shouldDisposeOfPCastExpress) {
            this._pcastExpress.dispose();
        }
    };

    RoomExpress.prototype.getPCastExpress = function getPCastExpress() {
        return this._pcastExpress;
    };

    // Responsible for creating room. Returns immutable room
    RoomExpress.prototype.createRoom = function createRoom(options, callback) {
        assert.isFunction(callback, 'callback');
        assert.isObject(options.room, 'options.room');
        assert.isStringNotEmpty(options.room.name, 'options.room.name');
        assert.isStringNotEmpty(options.room.type, 'options.room.type');

        if (options.room.description) {
            assert.isStringNotEmpty(options.room.description, 'options.room.description');
        }

        var roomDescription = options.room.description || getDefaultRoomDescription(options.room.type);

        createRoomService.call(this, null, null, function(error, roomServiceResponse) {
            if (error) {
                return callback(error);
            }

            if (roomServiceResponse.status !== 'ok') {
                return callback(null, roomServiceResponse);
            }

            var roomService = roomServiceResponse.roomService;
            var roomToCreate = _.assign({}, options.room);

            if (!roomToCreate.description) {
                roomToCreate.description = roomDescription;
            }

            roomService.createRoom(roomToCreate, function(error, roomResponse) {
                if (error) {
                    return callback(error);
                }

                // Don't return room service. Not in room. Room returned is immutable
                roomService.stop();

                return callback(null, roomResponse);
            });
        });
    };

    RoomExpress.prototype.joinRoom = function joinRoom(options, joinRoomCallback, membersChangedCallback) {
        assert.isObject(options, 'options');
        assert.isFunction(joinRoomCallback, 'joinRoomCallback');
        assert.isStringNotEmpty(options.role, 'options.role');

        if (membersChangedCallback) {
            assert.isFunction(membersChangedCallback, 'membersChangedCallback');
        }

        if (options.screenName) {
            assert.isStringNotEmpty(options.screenName, 'options.screenName');
        }

        if (options.roomId) {
            assert.isStringNotEmpty(options.roomId, 'options.roomId');
        }

        if (options.alias) {
            assert.isStringNotEmpty(options.alias, 'options.alias');
        }

        if (options.streams) {
            assert.isArray(options.streams, 'options.streams');
        }

        var that = this;
        var joinRoomWithPCast = function(pcast) {
            if (!pcast) {
                return;
            }

            joinRoomWithOptions.call(that, options, function(error, response) {
                var joinRoomResponse = response;

                if (joinRoomResponse && joinRoomResponse.roomService) {
                    var leaveRoom = joinRoomResponse.roomService.leaveRoom;

                    joinRoomResponse.roomService.leaveRoom = function(callback) {
                        if (subscription && pcast.getObservableStatus() !== 'offline') {
                            subscription.dispose();
                        }

                        leaveRoom(callback);
                    };
                }

                joinRoomCallback(error, response);
            }, membersChangedCallback);
        };

        if (this._pcastExpress.getPCastObservable()) {
            return joinRoomWithPCast(this._pcastExpress.getPCastObservable());
        }

        var subscription = this._pcastExpress.getPCastObservable().subscribe(joinRoomWithPCast);
    };

    RoomExpress.prototype.publishToRoom = function publishToRoom(options, callback) {
        assert.isObject(options, 'options');
        assert.isFunction(callback, 'callback');
        assert.isObject(options.room, 'options.room');

        if (options.streamUri) {
            assert.isStringNotEmpty(options.streamUri, 'options.streamUri');
        } else if (options.mediaConstraints) {
            assert.isObject(options.mediaConstraints, 'options.mediaConstraints');
        } else {
            assert.isObject(options.userMediaStream, 'options.userMediaStream');
        }

        if (options.videoElement) {
            assert.isObject(options.videoElement, 'options.videoElement');
        }

        if (options.screenName) {
            assert.isStringNotEmpty(options.screenName, 'options.screenName');
        }

        if (options.capabilities) {
            assert.isArray(options.capabilities, 'options.capabilities');
        }

        if (options.tags) {
            assert.isArray(options.tags, 'options.tags');
        }

        if (options.streamInfo) {
            assert.isObject(options.streamInfo, 'options.streamInfo');
        }

        if (options.viewerStreamSelectionStrategy) {
            assert.isStringNotEmpty(options.viewerStreamSelectionStrategy, 'options.viewerStreamSelectionStrategy');
        }

        if (_.isUndefined(options.enableWildcardCapability)) {
            options.enableWildcardCapability = defaultWildcardEnabled;
        }

        assert.isValidType(options.streamType, streamEnums.types, 'options.streamType');
        assert.isValidType(options.memberRole, memberEnums.roles, 'options.memberRole');
        assert.isBoolean(options.enableWildcardCapability, 'options.enableWildcardCapability');

        var that = this;
        var screenName = options.screenName || _.uniqueId();

        this.createRoom(options, function(error, createRoomResponse) {
            if (error) {
                return callback(error);
            }

            if (createRoomResponse.status !== 'ok' && createRoomResponse.status !== 'already-exists') {
                return callback(null, createRoomResponse);
            }

            var room = createRoomResponse.room;
            var publishOptions = _.assign({
                monitor: {
                    callback: _.bind(monitorSubsciberOrPublisher, that, callback),
                    options: {conditionCountForNotificationThreshold: 8}
                },
                streamInfo: {}
            }, options);

            if (room.getObservableType().getValue() === roomEnums.types.channel.name) {
                publishOptions.tags = ['channelId:' + room.getRoomId()].concat(publishOptions.tags || []);
            } else {
                publishOptions.tags = ['roomId:' + room.getRoomId()].concat(publishOptions.tags || []);
            }

            if (options.streamUri) {
                var remoteOptions = _.assign({connectOptions: []}, publishOptions);
                var hasRoomConnectOptions = _.find(remoteOptions.connectOptions, function(option) {
                    return _.startsWith(option, 'room-id');
                });

                if (!hasRoomConnectOptions) {
                    remoteOptions.connectOptions = remoteOptions.connectOptions.concat([
                        'room-id=' + room.getRoomId(),
                        'member-role=' + options.memberRole,
                        'member-stream-type=' + options.streamType,
                        'screen-name=' + screenName
                    ]);
                }

                if (options.enableWildcardCapability) {
                    remoteOptions.connectOptions.concat([
                        'member-stream-token-type=Wildcard',
                        'member-stream-token-refresh-interval=' + defaultStreamWildcardTokenRefreshInterval
                    ]);
                }

                return that._pcastExpress.publishRemote(remoteOptions, callback);
            }

            var joinRoomAsAudienceOptions = _.assign({}, options, {
                role: memberEnums.roles.audience.name,
                roomId: room.getRoomId()
            });

            joinRoomWithOptions.call(that, joinRoomAsAudienceOptions, function(error, response) {
                if (error) {
                    return callback(error);
                }

                if (response.status !== 'ok' && response.status !== 'already-in-room') {
                    return callback(null, createRoomResponse);
                }

                var activeRoom = response.roomService.getObservableActiveRoom().getValue();

                publishAndUpdateSelf.call(that, publishOptions, activeRoom, callback);
            });
        });
    };

    RoomExpress.prototype.publishScreenToRoom = function publishScreenToRoom(options, callback) {
        var publishScreenOptions = _.assign({mediaConstraints: {screen: true}}, options);

        this.publishToRoom(publishScreenOptions, callback);
    };

    RoomExpress.prototype.subscribeToMemberStream = function(memberStream, options, callback) {
        assert.isObject(memberStream, 'memberStream');
        assert.isObject(options, 'options');
        assert.isFunction(callback, 'callback');

        var streamUri = memberStream.getUri();
        var streamId = memberStream.getPCastStreamId();
        var streamToken = parseStreamTokenFromStreamUri(streamUri, options.capabilities);
        var isScreen = _.get(memberStream.getInfo(), ['isScreen'], false);

        if (!streamId) {
            this._logger.error('Invalid Member Stream. Unable to parse streamId from uri');

            throw new Error('Invalid Member Stream. Unable to parse streamId from uri');
        }

        var subscribeOptions = _.assign({}, {
            streamId: streamId,
            streamToken: streamToken
        }, options);
        var disposables = new disposable.DisposableList();

        subscribeToMemberStream.call(this, subscribeOptions, isScreen, function(error, response) {
            disposables.dispose();

            if (response && response.status === 'ok' && response.mediaStream && response.mediaStream.getStream()) {
                disposables.add(memberStream.getObservableAudioState().subscribe(function(state) {
                    var monitor = response.mediaStream.getMonitor();
                    var tracks = response.mediaStream.getStream().getAudioTracks();

                    if (monitor && tracks.length === 1) {
                        monitor.setMonitorTrackState(tracks[0], state === trackEnums.states.trackEnabled.name);
                    }
                }, {initial: 'notify'}));
                disposables.add(memberStream.getObservableVideoState().subscribe(function(state) {
                    var monitor = response.mediaStream.getMonitor();
                    var tracks = response.mediaStream.getStream().getVideoTracks();

                    if (monitor && tracks.length === 1) {
                        monitor.setMonitorTrackState(tracks[0], state === trackEnums.states.trackEnabled.name);
                    }
                }, {initial: 'notify'}));
            }

            if (error && parseInt(error.category) === 6) {
                return callback(error, {status: 'device-insecure'});
            }

            callback(error, response);
        });
    };

    function disposeOfRoomServices() {
        _.forOwn(this._membersSubscriptions, function(membersSubscription) {
            membersSubscription.dispose();
        });
        _.forOwn(this._roomServicePublishers, function(publishers) {
            _.forEach(publishers, function(publisher) {
                publisher.stop();
            });
        });
        _.forOwn(this._roomServices, function(roomService) {
            roomService.stop();
        });

        this._membersSubscriptions = {};
        this._roomServicePublishers = {};
        this._roomServices = {};
        this._activeRoomServices = [];
    }

    function createRoomService(roomId, alias, callback) {
        var that = this;
        var uniqueId = _.uniqueId();

        this._pcastExpress.waitForOnline(function(error) {
            if (error) {
                return callback(error);
            }

            var activeRoomService = findActiveRoom.call(that, roomId, alias);

            if (activeRoomService) {
                return callback(null, {
                    status: 'ok',
                    roomService: activeRoomService
                });
            }

            that._roomServices[uniqueId] = new RoomService(that._pcastExpress.getPCast());

            var expressRoomService = createExpressRoomService.call(that, that._roomServices[uniqueId], uniqueId);

            callback(null, {
                status: 'ok',
                roomService: expressRoomService
            });
        });
    }

    function findActiveRoom(roomId, alias) {
        return _.find(this._activeRoomServices, function(roomService) {
            var activeRoom = roomService.getObservableActiveRoom().getValue();

            return activeRoom && (activeRoom.getRoomId() === roomId || activeRoom.getObservableAlias().getValue() === alias);
        });
    }

    function createExpressRoomService(roomService, uniqueId) {
        var that = this;
        var roomServiceStop = roomService.stop;
        var roomServiceLeaveRoom = roomService.leaveRoom;

        roomService.stop = function() {
            roomServiceStop.call(roomService);

            delete that._roomServices[uniqueId];
        };

        roomService.leaveRoom = function leaveRoom(callback) {
            var room = roomService.getObservableActiveRoom().getValue();

            roomServiceLeaveRoom.call(roomService, function(error, response) {
                if (error) {
                    roomService.stop();

                    return callback(error);
                }

                if (response.status !== 'ok' && response.status !== 'not-in-room') {
                    return callback(null, response);
                }

                if (room && that._membersSubscriptions[room.getRoomId()]) {
                    that._membersSubscriptions[room.getRoomId()].dispose();

                    delete that._membersSubscriptions[room.getRoomId()];
                }

                that._logger.info('Successfully disposed of Express Room Service [%s]', room ? room.getRoomId() : 'Uninitialized');

                roomService.stop();

                return callback(null, response);
            });
        };

        return roomService;
    }

    function joinRoomWithOptions(options, joinRoomCallback, membersChangedCallback) {
        var that = this;
        var role = options.role;
        var screenName = options.screenName || _.uniqueId();

        createRoomService.call(that, options.roomId, options.alias, function(error, roomServiceResponse) {
            if (error) {
                return joinRoomCallback(error);
            }

            if (roomServiceResponse.status !== 'ok') {
                return joinRoomCallback(null, roomServiceResponse);
            }

            var roomService = roomServiceResponse.roomService;
            var activeRoomObservable = roomService.getObservableActiveRoom();
            var activeRoom = activeRoomObservable.getValue();
            var membersSubscription = null;

            if (!activeRoom) {
                roomService.start(role, screenName);
            }

            if (options.streams) {
                updateSelfStreamsAndRole.call(that, options.streams, options.role, roomService, function(error) {
                    if (error) {
                        return joinRoomCallback(error);
                    }
                });
            }

            if (activeRoom && membersChangedCallback) {
                joinRoomCallback(null, {
                    status: 'ok',
                    roomService: roomService
                });

                return activeRoomObservable.subscribe(function(newRoom) {
                    if (membersSubscription) {
                        membersSubscription.dispose();
                        membersSubscription = null;
                    }

                    if (!newRoom) {
                        return;
                    }

                    membersSubscription = newRoom.getObservableMembers().subscribe(membersChangedCallback, {initial: 'notify'});
                }, {initial: 'notify'});
            }

            roomService.enterRoom(options.roomId, options.alias, function(error, roomResponse) {
                if (error) {
                    roomService.stop();

                    return joinRoomCallback(error);
                }

                if (roomResponse.status === 'not-found') {
                    roomService.stop();

                    return joinRoomCallback(null, {status: 'room-not-found'});
                }

                if (roomResponse.status !== 'ok' && roomResponse.status !== 'already-in-room') {
                    roomService.stop();

                    return joinRoomCallback(null, roomResponse);
                }

                var room = roomResponse.room;

                that._activeRoomServices.push(roomService);

                joinRoomCallback(null, {
                    status: 'ok',
                    roomService: roomService
                });

                if (membersChangedCallback) {
                    membersSubscription = room.getObservableMembers().subscribe(membersChangedCallback, {initial: 'notify'});

                    return activeRoomObservable.subscribe(function(newRoom) {
                        if (membersSubscription) {
                            membersSubscription.dispose();
                            membersSubscription = null;
                        }

                        if (!newRoom) {
                            return;
                        }

                        membersSubscription = newRoom.getObservableMembers().subscribe(membersChangedCallback, {initial: 'notify'});
                    });
                }
            });
        });
    }

    function subscribeToMemberStream(subscribeOptions, isScreen, callback) {
        var that = this;

        var count = 0;
        var handleSubscribe = function(error, response) {
            if (error) {
                return callback(error);
            }

            if (response.status !== 'ok' && response.status !== 'streaming-not-ready') {
                return callback(null, response);
            }

            count++;

            if (response.status === 'streaming-not-ready' && count < 3) {
                return setTimeout(response.retry, count * count * 1000);
            } else if (response.status === 'streaming-not-ready' && count >= 3) {
                return callback(null, {status: response.status});
            }

            var subscribeResponse = _.assign({}, response, {status: 'ok'});

            if (count > 1) {
                subscribeResponse.reason = 'stream-failure-recovered';

                return callback(null, subscribeResponse);
            }

            callback(null, subscribeResponse);
        };

        if (isScreen) {
            return that._pcastExpress.subscribeToScreen(subscribeOptions, handleSubscribe);
        }

        return that._pcastExpress.subscribe(subscribeOptions, handleSubscribe);
    }

    function publishAndUpdateSelf(options, room, callback) {
        var that = this;
        var publisher;
        var refreshTokenTimeout;

        var handlePublish = function(error, response) {
            if (refreshTokenTimeout && publisher) {
                clearInterval(refreshTokenTimeout);
            }

            if (error) {
                return callback(error);
            }

            if (response.status !== 'ok') {
                return callback(null, response);
            }

            addPublisher.call(that, response.publisher, room);
            removePublisher.call(that, publisher, room);

            publisher = response.publisher;

            var publisherStop = _.bind(publisher.stop, publisher);

            publisher.stop = function() {
                clearInterval(refreshTokenTimeout);
                publisherStop.apply(publisher, arguments);
            };

            if (options.enableWildcardCapability) {
                refreshTokenTimeout = setInterval(function() {
                    that._logger.debug('Refresh wildcard viewer stream token for [%s] interval of [%s] has expired. Creating new token.',
                        publisher.getStreamId(), defaultStreamWildcardTokenRefreshInterval);

                    var activeRoomService = findActiveRoom.call(that, room.getRoomId());
                    var activeRoom = activeRoomService ? activeRoomService.getObservableActiveRoom().getValue() : room;

                    createViewerStreamTokensAndUpdateSelf.call(that, options, publisher, activeRoom, function ignoreSuccess(error, response) {
                        if (error || response.status !== 'ok') {
                            callback(error, response);
                        }
                    });
                }, defaultStreamWildcardTokenRefreshInterval);
            }

            createViewerStreamTokensAndUpdateSelf.call(that, options, response.publisher, room, callback);
        };

        if (_.get(options, ['mediaConstraints', 'screen'], false)) {
            _.set(options, ['streamInfo', 'isScreen'], true);

            return this._pcastExpress.publishScreen(options, handlePublish);
        }

        this._pcastExpress.publish(options, handlePublish);
    }

    function addPublisher(publisher, room) {
        if (!this._roomServicePublishers[room.getRoomId()]) {
            this._roomServicePublishers[room.getRoomId()] = [];
        }

        this._roomServicePublishers[room.getRoomId()].push(publisher);
    }

    function removePublisher(publisher, room) {
        if (!this._roomServicePublishers[room.getRoomId()] || !publisher) {
            return;
        }

        this._roomServicePublishers[room.getRoomId()] = _.filter(this._roomServicePublishers[room.getRoomId()], function(roomPublisher) {
            return roomPublisher.getStreamId() !== publisher.getStreamId();
        });
    }

    function createViewerStreamTokensAndUpdateSelf(options, publisher, room, callback) {
        var that = this;
        var streamType = options.streamType;
        var streamInfo = options.streamInfo;
        var composeWithAdditionalStreams = options.viewerStreamSelectionStrategy === 'high-availability' && room.getObservableType().getValue() === roomEnums.types.channel.name;
        var additionalStreamIds = null;
        var handleJoinRoomCallback = callback;
        var disposable;

        if (!options.enableWildcardCapability) {
            var publisherStream = mapStreamToMemberStream(publisher, streamType, streamInfo);
            var updateSelfOptions = _.assign({}, options, {streams: mapNewPublisherStreamToMemberStreams.call(that, publisherStream, room)});

            return updateSelfAndListenForChanges.call(that, updateSelfOptions, handleJoinRoomCallback, publisher, room);
        }

        if (composeWithAdditionalStreams) {
            var membersWithSameContent = MemberSelector.getSimilarMembers(options.screenName, room.getObservableMembers().getValue());

            additionalStreamIds = getValidStreamIds(membersWithSameContent);

            handleJoinRoomCallback = function(error, response) {
                callback(error, response);

                var roomService = _.get(response, 'roomService', findActiveRoom.call(that, room.getRoomId()));

                if (error || response.status !== 'ok' || disposable || !roomService) {
                    return;
                }

                var activeRoom = roomService.getObservableActiveRoom().getValue();

                disposable = activeRoom.getObservableMembers().subscribe(function(members) {
                    var newMembersWithSameContent = MemberSelector.getSimilarMembers(options.screenName, members);
                    var newAdditionalStreamIds = getValidStreamIds(newMembersWithSameContent);
                    var areTheSame = newAdditionalStreamIds.length === additionalStreamIds.length && _.reduce(newAdditionalStreamIds, function(areAllPreviousTheSame, streamId) {
                        return areAllPreviousTheSame ? _.includes(additionalStreamIds, streamId) : areAllPreviousTheSame;
                    }, true);

                    if (areTheSame) {
                        return;
                    }

                    that._logger.debug('Members with similar content to stream [%s] have changed. Generating new wildcard viewer token', publisher.getStreamId());

                    disposable.dispose();
                    disposable = null;

                    createViewerStreamTokensAndUpdateSelf.call(that, options, publisher, activeRoom, function ignoreSuccess(error, response) {
                        if (error || response.status !== 'ok') {
                            callback(error, response);
                        }
                    });
                });
            };
        }

        if (additionalStreamIds && additionalStreamIds.length > 0) {
            that._logger.debug('Creating [real-time] viewer wildcard stream token for published stream [%s] with [%s] additional streams', publisher.getStreamId(), additionalStreamIds.length);
        } else {
            that._logger.debug('Creating [real-time] viewer wildcard stream token for published stream [%s]', publisher.getStreamId());
        }

        that._pcastExpress.getAdminAPI().createStreamTokenForSubscribing('*', [], publisher.getStreamId(), additionalStreamIds, function(error, createStreamTokenResponse) {
            if (error) {
                return callback(error);
            }

            if (createStreamTokenResponse.status !== 'ok') {
                return callback(null, createStreamTokenResponse);
            }

            if (additionalStreamIds && additionalStreamIds.length > 0) {
                that._logger.debug('Creating [broadcast] viewer wildcard stream token for published stream [%s] with [%s] additional streams', publisher.getStreamId(), additionalStreamIds.length);
            } else {
                that._logger.debug('Creating [broadcast] viewer wildcard stream token for published stream [%s]', publisher.getStreamId());
            }

            that._pcastExpress.getAdminAPI().createStreamTokenForSubscribing('*', ['broadcast'], publisher.getStreamId(), additionalStreamIds, function(error, createStreamTokenBroadcastResponse) {
                if (error) {
                    return callback(error);
                }

                if (createStreamTokenBroadcastResponse.status !== 'ok') {
                    return callback(null, createStreamTokenBroadcastResponse);
                }

                if (_.includes(options.capabilities, 'streaming')) {
                    if (additionalStreamIds && additionalStreamIds.length > 0) {
                        that._logger.debug('Creating [streaming] viewer wildcard stream token for published stream [%s] with [%s] additional streams', publisher.getStreamId(), additionalStreamIds.length);
                    } else {
                        that._logger.debug('Creating [streaming] viewer wildcard stream token for published stream [%s]', publisher.getStreamId());
                    }

                    return that._pcastExpress.getAdminAPI().createStreamTokenForSubscribing('*', ['streaming'], publisher.getStreamId(), additionalStreamIds, function(error, createStreamTokenWithStreamingResponse) {
                        if (error) {
                            return callback(error);
                        }

                        if (createStreamTokenWithStreamingResponse.status !== 'ok') {
                            return callback(null, createStreamTokenWithStreamingResponse);
                        }

                        if (_.includes(options.capabilities, 'drm')) {
                            if (additionalStreamIds && additionalStreamIds.length > 0) {
                                that._logger.debug('Creating [drm-open-access] and [drm-hollywood] viewer wildcard stream token for published stream [%s] with [%s] additional streams', publisher.getStreamId(), additionalStreamIds.length);
                            } else {
                                that._logger.debug('Creating [drm-open-access] and [drm-hollywood] viewer wildcard stream token for published stream [%s]', publisher.getStreamId());
                            }

                            return that._pcastExpress.getAdminAPI().createStreamTokenForSubscribing('*', ['streaming', 'drm-open-access'], publisher.getStreamId(), additionalStreamIds, function(error, createStreamTokenWithStreamingDrmOpenAccessResponse) {
                                if (error) {
                                    return callback(error);
                                }

                                if (createStreamTokenWithStreamingDrmOpenAccessResponse.status !== 'ok') {
                                    return callback(null, createStreamTokenWithStreamingDrmOpenAccessResponse);
                                }

                                return that._pcastExpress.getAdminAPI().createStreamTokenForSubscribing('*', ['streaming', 'drm-hollywood'], publisher.getStreamId(), additionalStreamIds, function(error, createStreamTokenWithStreamingDrmHollywoodResponse) {
                                    if (error) {
                                        return callback(error);
                                    }

                                    if (createStreamTokenWithStreamingDrmHollywoodResponse.status !== 'ok') {
                                        return callback(null, createStreamTokenWithStreamingDrmHollywoodResponse);
                                    }

                                    var drmTokens = [createStreamTokenWithStreamingDrmOpenAccessResponse.streamToken, createStreamTokenWithStreamingDrmHollywoodResponse.streamToken];
                                    var publisherStream = mapStreamToMemberStream(publisher, streamType, streamInfo, createStreamTokenResponse.streamToken, createStreamTokenBroadcastResponse.streamToken, createStreamTokenWithStreamingResponse.streamToken, drmTokens);
                                    var updateSelfOptions = _.assign({}, options, {streams: mapNewPublisherStreamToMemberStreams.call(that, publisherStream, room)});

                                    updateSelfAndListenForChanges.call(that, updateSelfOptions, handleJoinRoomCallback, publisher, room);
                                });
                            });
                        }

                        var publisherStream = mapStreamToMemberStream(publisher, streamType, streamInfo, createStreamTokenResponse.streamToken, createStreamTokenBroadcastResponse.streamToken, createStreamTokenWithStreamingResponse.streamToken);
                        var updateSelfOptions = _.assign({}, options, {streams: mapNewPublisherStreamToMemberStreams.call(that, publisherStream, room)});

                        updateSelfAndListenForChanges.call(that, updateSelfOptions, handleJoinRoomCallback, publisher, room);
                    });
                }

                var publisherStream = mapStreamToMemberStream(publisher, streamType, streamInfo, createStreamTokenResponse.streamToken, createStreamTokenBroadcastResponse.streamToken);
                var updateSelfOptions = _.assign({}, options, {streams: mapNewPublisherStreamToMemberStreams.call(that, publisherStream, room)});

                updateSelfAndListenForChanges.call(that, updateSelfOptions, handleJoinRoomCallback, publisher, room);
            });
        });
    }

    function getValidStreamIds(members) {
        return _.reduce(members, function(streamIds, member) {
            var stream = _.get(member.getObservableStreams().getValue(), '0');
            var streamId = stream ? stream.getPCastStreamId() : '';

            if (streamId) {
                streamIds.push(streamId);
            }

            return streamIds;
        }, []);
    }

    function updateSelfAndListenForChanges(options, callback, publisher, room) {
        var that = this;
        var activeRoomService = findActiveRoom.call(that, room.getRoomId());
        var responseObject = {
            publisher: publisher,
            roomService: activeRoomService
        };
        var handleUpdate = function(error, response) {
            if (error) {
                return callback(error);
            }

            if (response.status === 'ok') {
                activeRoomService = findActiveRoom.call(that, room.getRoomId());

                var selfStreams = activeRoomService.getSelf().getObservableStreams().getValue();
                var publishedSelfStream = _.find(selfStreams, function(selfStream) {
                    return selfStream.getPCastStreamId() === publisher.getStreamId();
                });

                listenForTrackStateChange.call(that, publisher.getStream(), publishedSelfStream);
            }

            // TODO(DY) Clean up once event based listeners are exposed on the publisher for stop/end
            if (response.status === 'ok' && !publisher._cleanUpRoomWrapper) {
                var publisherStop = _.bind(publisher.stop, publisher);

                publisher._cleanUpRoomWrapper = true;

                publisher.stop = function() {
                    removePublisher.call(that, publisher, room);

                    var streamsAfterStop = mapNewPublisherStreamToMemberStreams.call(that, null, room);
                    var roomService = findActiveRoom.call(that, room.getRoomId());

                    publisherStop.apply(publisher, arguments);

                    if (!roomService) {
                        return;
                    }

                    updateSelfStreamsAndRoleAndEnterRoomIfNecessary.call(that, streamsAfterStop, options.memberRole, roomService, options, function(error) {
                        if (error) {
                            return callback(error);
                        }
                    });
                };
            }

            return callback(null, _.assign({}, responseObject, response));
        };

        updateSelfStreamsAndRoleAndEnterRoomIfNecessary.call(that, options.streams, options.memberRole, activeRoomService, options, handleUpdate);
    }

    function mapNewPublisherStreamToMemberStreams(publisherStream, room) {
        var activeRoomService = findActiveRoom.call(this, room.getRoomId());
        var defaultStreams = publisherStream ? [publisherStream] : [];

        if (!activeRoomService) {
            return defaultStreams;
        }

        var self = activeRoomService.getSelf();

        if (!self) {
            return defaultStreams;
        }

        var selfStreams = _.map(self.getObservableStreams().getValue(), function(selfStream) {
            return selfStream.toJson();
        });
        var publishers = this._roomServicePublishers[room.getRoomId()] || [];
        var publisherIds = _.map(publishers, function(publisher) {
            return publisher.getStreamId();
        });

        if (!selfStreams || selfStreams.length === 0) {
            return defaultStreams;
        }

        if (publisherStream) {
            selfStreams = _.filter(selfStreams, function(stream) {
                var hasSameUri = stream.uri === publisherStream.uri;
                var pcastStreamId = Stream.parsePCastStreamIdFromStreamUri(stream.uri);
                var isPCastStream = !!pcastStreamId;
                var hasSamePCastStreamId = isPCastStream && pcastStreamId === Stream.parsePCastStreamIdFromStreamUri(publisherStream.uri);
                var hasSameType = stream.type === publisherStream.type;

                return (!hasSameUri && !hasSamePCastStreamId) || !hasSameType;
            });

            selfStreams.push(publisherStream);
        }

        return _.filter(selfStreams, function(stream) {
            return _.includes(publisherIds, Stream.parsePCastStreamIdFromStreamUri(stream.uri) || stream.uri);
        });
    }

    function updateSelfStreamsAndRole(streams, role, roomService, callback) {
        var activeRoom = roomService ? roomService.getObservableActiveRoom().getValue() : null;

        if (streams && roomService) {
            roomService.getSelf().setStreams(streams);
        }

        if (role && roomService) {
            roomService.getSelf().getObservableRole().setValue(role);
        }

        if (activeRoom && roomService.getSelf()) {
            return updateSelfWithRetry.call(this, roomService.getSelf(), callback);
        }
    }

    function updateSelfStreamsAndRoleAndEnterRoomIfNecessary(streams, role, roomService, options, callback) {
        var activeRoomService = findActiveRoom.call(this, options.room.roomId, options.room.alias);
        var activeRoom = roomService ? roomService.getObservableActiveRoom().getValue() : null;
        var shouldJoinRoom = !activeRoom && !activeRoomService;
        var that = this;

        if (streams && activeRoomService) {
            activeRoomService.getSelf().setStreams(streams);
        }

        if (role && activeRoomService) {
            activeRoomService.getSelf().getObservableRole().setValue(role);
        }

        if (activeRoom && activeRoomService.getSelf()) {
            return updateSelfWithRetry.call(this, activeRoomService.getSelf(), callback);
        }

        if (shouldJoinRoom) {
            var joinRoomAsPresenterOptions = _.assign({
                role: role,
                alias: _.get(options, ['room', 'alias']),
                roomId: _.get(options, ['room', 'roomId'])
            }, options);

            joinRoomWithOptions.call(that, joinRoomAsPresenterOptions, function(error, response) {
                if (error) {
                    return callback(error);
                }

                if (response.status !== 'ok' && response.status !== 'already-in-room') {
                    return callback(null, response);
                }

                callback(error, response);
            });
        }
    }

    function updateSelfWithRetry(self, callback) {
        var updateSelfErrors = 0;
        var that = this;
        var maxUpdateSelfRetries = 5;

        try {
            self.commitChanges(function handleUpdateSelf(error, response) {
                if (error) {
                    updateSelfErrors++;
                }

                if (response && response.status !== 'ok') {
                    updateSelfErrors++;
                }

                if (response && response.status === 'ok') {
                    updateSelfErrors = 0;

                    return !callback || callback(null, response);
                }

                if (updateSelfErrors >= maxUpdateSelfRetries) {
                    that._logger.warn('Unable to update self after [%s] attempts.', maxUpdateSelfRetries);

                    return callback(new Error('Unable to update self'));
                }

                if (updateSelfErrors > 0 && updateSelfErrors < maxUpdateSelfRetries) {
                    that._logger.warn('Unable to update self after [%s] attempts. Retrying.', updateSelfErrors);

                    return self.commitChanges(handleUpdateSelf);
                }
            });
        } catch (error) {
            callback(error);
        }
    }

    function monitorSubsciberOrPublisher(callback, error, response) {
        if (error) {
            return callback(error);
        }

        if (response.retry) {
            return response.retry();
        }

        callback(error, response);
    }

    function getDefaultRoomDescription(type) {
        switch(type) {
        case roomEnums.types.channel.name:
            return 'Room Channel';
        case roomEnums.types.moderatedChat.name:
            return 'Moderated Chat';
        case roomEnums.types.multiPartyChat.name:
            return 'Multi Party Chat';
        case roomEnums.types.townHall.name:
            return 'Town Hall';
        case roomEnums.types.directChat.name:
            return 'Direct Chat';
        default:
            throw new Error('Unsupported Room Type');
        }
    }

    function parseStreamTokenFromStreamUri(uri, capabilities) {
        var streamInfo = Stream.getInfoFromStreamUri(uri);
        // TODO(DY) Remove streamTokenStreaming once apps updated in prod
        var isStreaming = (streamInfo.streamTokenForLiveStream || streamInfo.streamTokenStreaming) && _.includes(capabilities, 'streaming');

        // Token for both not generated.
        if (_.includes(capabilities, 'drm-open-access') && _.includes(capabilities, 'drm-hollywood')) {
            return;
        }

        if (isStreaming && streamInfo.streamTokenForLiveStreamWithDrmOpenAccess && (_.includes(capabilities, 'drm-open-access') || isAndroid())) {
            return streamInfo.streamTokenForLiveStreamWithDrmOpenAccess;
        }

        if (isStreaming && streamInfo.streamTokenForLiveStreamWithDrmHollywood && _.includes(capabilities, 'drm-hollywood')) {
            return streamInfo.streamTokenForLiveStreamWithDrmHollywood;
        }

        if (isStreaming && !_.includes(capabilities, 'drm-open-access') && !_.includes(capabilities, 'drm-hollywood')) {
            return streamInfo.streamTokenForLiveStream || streamInfo.streamTokenStreaming;
        }

        if (streamInfo.streamTokenForBroadcastStream && _.includes(capabilities, 'broadcast')) {
            return streamInfo.streamTokenForBroadcastStream;
        }

        if (!_.includes(capabilities, 'streaming') && !_.includes(capabilities, 'broadcast')) {
            return streamInfo.streamToken;
        }
    }

    function mapStreamToMemberStream(publisher, type, streamInfo, viewerStreamToken, viewerStreamTokenForBroadcastStream, viewerStreamTokenForLiveStream, drmStreamTokens) {
        var mediaStream = publisher.getStream();
        var audioTracks = mediaStream ? mediaStream.getAudioTracks() : null;
        var videoTracks = mediaStream ? mediaStream.getVideoTracks() : null;
        var audioTrackEnabled = audioTracks.length > 0 && audioTracks[0].enabled;
        var videoTrackEnabled = videoTracks.length > 0 && videoTracks[0].enabled;

        var publishedStream = {
            uri: Stream.getPCastPrefix() + publisher.getStreamId(),
            type: type,
            audioState: audioTrackEnabled ? trackEnums.states.trackEnabled.name : trackEnums.states.trackDisabled.name,
            videoState: videoTrackEnabled ? trackEnums.states.trackEnabled.name : trackEnums.states.trackDisabled.name
        };

        var infoToAppend = _.assign({}, streamInfo, {
            streamToken: viewerStreamToken,
            streamTokenForBroadcastStream: viewerStreamTokenForBroadcastStream,
            streamTokenForLiveStream: viewerStreamTokenForLiveStream
        });

        if (!viewerStreamToken) {
            delete infoToAppend.streamToken;
        }

        if (!viewerStreamTokenForBroadcastStream) {
            delete infoToAppend.streamTokenForBroadcastStream;
        }

        if (!viewerStreamTokenForLiveStream) {
            delete infoToAppend.streamTokenForLiveStream;
        }

        if (drmStreamTokens) {
            assert.isArray(drmStreamTokens, 'drmStreamTokens');

            infoToAppend.streamTokenForLiveStreamWithDrmOpenAccess = drmStreamTokens[0];
            infoToAppend.streamTokenForLiveStreamWithDrmHollywood = drmStreamTokens[1];
        }

        var queryParamString = _.reduce(infoToAppend, function(queryParamString, currentValue, currentKey) {
            var currentPrefix = queryParamString ? '&' : '?';

            return queryParamString + currentPrefix + currentKey + '=' + currentValue;
        }, '');

        if (queryParamString.length > 0) {
            publishedStream.uri = publishedStream.uri + queryParamString;
        }

        return publishedStream;
    }

    function listenForTrackStateChange(stream, memberStream) {
        var tracks = stream.getTracks();
        var that = this;

        _.forEach(tracks, function(track) {
            _.addEventListener(track, 'StateChange', function() {
                var state = track.enabled ? trackEnums.states.trackEnabled.name : trackEnums.states.trackDisabled.name;
                var self = getSelfAssociatedWithStream.call(that, memberStream);

                that._logger.info('[%s] [%s] Track state changed to [%s], updating room member stream state [%s]', stream.id, track.id, track.enabled, state);

                if (track.kind === 'video') {
                    memberStream.getObservableVideoState().setValue(state);
                } else {
                    memberStream.getObservableAudioState().setValue(state);
                }

                if (self) {
                    updateSelfWithRetry.call(that, self);
                }
            });
        });
    }

    function getSelfAssociatedWithStream(memberStream) {
        var roomService = _.find(this._activeRoomServices, function(roomService) {
            var self = roomService.getSelf();
            var selfStreams = self ? self.getObservableStreams().getValue() : [];

            return _.find(selfStreams, function(selfStream) {
                return memberStream === selfStream;
            });
        });

        return roomService ? roomService.getSelf() : null;
    }

    function isAndroid() {
        return /(android)/i.test(navigator.userAgent);
    }

    return RoomExpress;
});