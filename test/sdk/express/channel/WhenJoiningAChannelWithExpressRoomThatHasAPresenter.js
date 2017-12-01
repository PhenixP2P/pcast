/**
 * Copyright 2017 Phenix Inc. All Rights Reserved.
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
    'sdk/express/RoomExpress',
    '../../../../test/mock/HttpStubber',
    '../../../../test/mock/WebSocketStubber',
    '../../../../test/mock/ChromeRuntimeStubber',
    '../../../../test/mock/PeerConnectionStubber',
    'sdk/room/Stream',
    'sdk/room/room.json',
    'sdk/room/member.json',
    'sdk/room/stream.json',
    'sdk/room/track.json',
    'sdk/PeerConnectionMonitor'
], function (_, RoomExpress, HttpStubber, WebSocketStubber, ChromeRuntimeStubber, PeerConnectionStubber, Stream, room, member, stream, track, PeerConnectionMonitor) {
    describe('When Joining a Channel With Express Room That Has A Presenter', function () {
        var mockBackendUri = 'https://mockUri';
        var mockAuthData = {
            name: 'mockUser',
            password: 'somePassword'
        };

        var httpStubber;
        var websocketStubber;
        var chromeRuntimeStubber = new ChromeRuntimeStubber();
        var peerConnectionStubber = new PeerConnectionStubber();
        var roomExpress;

        before(function() {
            chromeRuntimeStubber.stub();
            peerConnectionStubber.stub();
        });

        beforeEach(function () {
            httpStubber = new HttpStubber();
            httpStubber.stubAuthRequest();
            httpStubber.stubStreamRequest();

            websocketStubber = new WebSocketStubber();
            websocketStubber.stubAuthRequest();
            websocketStubber.stubSetupStream();
            websocketStubber.stubResponse('chat.JoinRoom', {
                status: 'ok',
                room: {
                    roomId: 'ChannelId',
                    alias: 'ChannelAlias',
                    name: 'ChannelAlias',
                    description: 'Channel',
                    type: room.types.channel.name
                },
                members: [{
                    sessionId: 'ChannelMemberId',
                    screenName: 'ChannelMember',
                    role: member.roles.presenter.name,
                    state: member.states.active.name,
                    streams: [{
                        uri: Stream.getPCastPrefix() + 'streamId',
                        type: stream.types.presentation.name,
                        audioState: track.states.trackEnabled.name,
                        videoState: track.states.trackEnabled.name
                    }],
                    lastUpdate: _.now()
                }]
            });

            roomExpress = new RoomExpress({
                backendUri: mockBackendUri,
                authenticationData: mockAuthData,
                uri: 'wss://mockURI'
            });
        });

        after(function() {
            chromeRuntimeStubber.restore();
            peerConnectionStubber.restore();
        });

        afterEach(function() {
            httpStubber.restore();
            websocketStubber.restore();
            roomExpress.dispose();
        });

        it('Expect monitor event to trigger a callback and re-subscribe', function (done) {
            var subscribeCount = 0;
            var startClone = PeerConnectionMonitor.prototype.start;

            PeerConnectionMonitor.prototype.start = function(options, activeCallback, monitorCallback) {
                setTimeout(function() {
                    monitorCallback('client-side-failure');
                }, 3);
            };

            roomExpress.joinChannel({
                capabilities: [],
                alias: 'ChannelAlias'
            }, function() {}, function(error, response) {
                if (response.status === 'ok') {
                    subscribeCount++;
                }

                if (subscribeCount === 2) {
                    PeerConnectionMonitor.prototype.start = startClone;
                    expect(response.status).to.be.equal('ok');
                    expect(subscribeCount).to.be.equal(2);
                    done();
                }
            });

            websocketStubber.triggerConnected();
        });

        it('Expect stream ended reason of ended to trigger callback with reason ended', function (done) {
            var subscribeCount = 0;

            roomExpress.joinChannel({
                capabilities: [],
                alias: 'ChannelAlias'
            }, function() {}, function(error, response) {
                if (response.status === 'ok') {
                    subscribeCount++;

                    return websocketStubber.stubEvent('pcast.StreamEnded', {
                        streamId: 'mockStreamId',
                        reason: 'ended',
                        sessionId: 'mockSessionId'
                    });
                }

                expect(subscribeCount).to.be.equal(1);
                expect(response.status).to.be.equal('ended');
                done();
            });

            setTimeout(websocketStubber.triggerConnected.bind(websocketStubber), 0);
        });
    });
});