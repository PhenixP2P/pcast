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
'use strict';

define('phenix-web-sdk', [
    'phenix-rtc',
    'phenix-web-logging',
    './sdk/PCast',
    './sdk/AdminAPI',
    './sdk/room/RoomService',
    './sdk/audio/AudioSpeakerDetector',
    './sdk/bandwidth/BandwidthMonitor',
    './sdk/userMedia/UserMediaResolver',
    './sdk/express/PCastExpress',
    './sdk/express/RoomExpress',
    './sdk/express/ChannelExpress'
], function(rtc, logging, PCast, RoomService, AudioSpeakerDetector, BandwidthMonitor, UserMediaResolver, PCastExpress, RoomExpress, ChannelExpress) {
    rtc.global.PhenixPCast = PCast;

    return {
        PCast: PCast,
        AdminAPI: AdminAPI,
        RoomService: RoomService,
        AudioSpeakerDetector: AudioSpeakerDetector,
        BandwidthMonitor: BandwidthMonitor,
        UserMediaResolver: UserMediaResolver,
        logging: logging,
        RTC: rtc,
        express: {
            PCastExpress: PCastExpress,
            RoomExpress: RoomExpress,
            ChannelExpress: ChannelExpress
        }
    };
});