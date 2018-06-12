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
    'phenix-web-assert'
], function(_, assert) {
    'use strict';

    function AuthenticationService(pcast) {
        assert.isObject(pcast, 'pcast');
        assert.isFunction(pcast.getObservableStatus, 'pcast.getObservableStatus');
        assert.isFunction(pcast.getLogger, 'pcast.getLogger');
        assert.isFunction(pcast.getProtocol, 'pcast.getProtocol');

        if (this._pcast === pcast) {
            return;
        }

        this._pcast = pcast;
        this._logger = pcast.getLogger();
        this._protocol = pcast.getProtocol();

        assert.isObject(this._logger, 'this._logger');
        assert.isObject(this._protocol, 'this._protocol');
        assert.isFunction(this._protocol.getObservableSessionId, 'this._protocol.getObservableSessionId');
        assert.isFunction(this._pcast.getObservableStatus, 'this._pcast.getObservableStatus');

        this._sessionId = this._protocol.getObservableSessionId();
        this._status = this._pcast.getObservableStatus();
    }

    AuthenticationService.prototype.assertAuthorized = function assertAuthorized() {
        if (!validPCastStatus(this.getPCastStatus())) {
            throw new Error('Unable to perform action. Status [' + this.getPCastStatus() + ']. Please wait to reconnect.');
        }

        if (!validPCastSessionId(this.getPCastSessionId())) {
            throw new Error('Unable to perform action. Invalid sessionId [' + this.getPCastSessionId() + ']');
        }
    };

    AuthenticationService.prototype.getObservableSessionId = function getObservableSessionId() {
        return this._sessionId;
    };

    AuthenticationService.prototype.getObservableStatus = function getObservableStatus() {
        return this._status;
    };

    AuthenticationService.prototype.getPCastSessionId = function getPCastSessionId() {
        return this._sessionId.getValue();
    };

    AuthenticationService.prototype.getPCastStatus = function getPCastStatus() {
        return this._status.getValue();
    };

    function validPCastSessionId(sessionId) {
        return sessionId !== null && sessionId !== undefined && sessionId !== '';
    }

    function validPCastStatus(status) {
        return status !== null && status !== undefined && status !== '' && status.toLowerCase() !== 'offline';
    }

    return AuthenticationService;
});