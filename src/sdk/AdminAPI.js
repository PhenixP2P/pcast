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
    'phenix-web-http',
    'phenix-web-disposable'
], function(_, assert, http, disposable) {
    'use strict';

    var networkUnavailableCode = 0;
    var requestMaxTimeout = 20000;
    var defaultRequestOptions = {
        timeout: requestMaxTimeout,
        retryOptions: {
            backoff: 1.5,
            delay: 1000,
            maxAttempts: 3,
            additionalRetryErrorCodes: [networkUnavailableCode]
        }
    };

    function AdminAPI(backendUri, authenticationData) {
        assert.isStringNotEmpty(backendUri, 'backendUri');
        assert.isObject(authenticationData, 'authenticationData');

        this._backendUri = backendUri;
        this._authenticationData = authenticationData;
        this._disposables = new disposable.DisposableList();
    }

    AdminAPI.prototype.dispose = function() {
        return this._disposables.dispose();
    };

    AdminAPI.prototype.getAuthenticationData = function getAuthenticationData() {
        return this._authenticationData;
    };

    AdminAPI.prototype.setAuthenticationData = function setAuthenticationData(authenticationData) {
        this._authenticationData = authenticationData;
    };

    AdminAPI.prototype.createAuthenticationToken = function createAuthenticationToken(callback) {
        var data = appendAuthDataTo.call(this, {});
        var requestWithoutCallback = _.bind(http.postWithRetry, http, this._backendUri + '/auth', JSON.stringify(data), defaultRequestOptions);

        return requestWithTimeout.call(this, requestWithoutCallback, callback);
    };

    AdminAPI.prototype.createStreamTokenForPublishing = function createStreamTokenForPublishing(sessionId, capabilities, callback) {
        assert.isStringNotEmpty(sessionId, 'sessionId');
        assert.isObject(capabilities, 'capabilities');

        var data = appendAuthDataTo.call(this, {
            sessionId: sessionId,
            capabilities: capabilities
        });
        var requestWithoutCallback = _.bind(http.postWithRetry, http, this._backendUri + '/stream', JSON.stringify(data), defaultRequestOptions);

        return requestWithTimeout.call(this, requestWithoutCallback, callback);
    };

    AdminAPI.prototype.createStreamTokenForSubscribing = function createStreamTokenForSubscribing(sessionId, capabilities, streamId, alternateStreamIds, callback) {
        assert.isStringNotEmpty(sessionId, 'sessionId');
        assert.isObject(capabilities, 'capabilities');

        if (!_.isNullOrUndefined(alternateStreamIds)) {
            assert.isArray(alternateStreamIds, 'additionalStreamIds');

            _.forEach(alternateStreamIds, function(alternateOriginStreamId) {
                assert.isStringNotEmpty(alternateOriginStreamId, 'alternateOriginStreamId');
            });
        }

        var data = appendAuthDataTo.call(this, {
            sessionId: sessionId,
            capabilities: capabilities,
            originStreamId: streamId
        });

        if (alternateStreamIds && alternateStreamIds.length > 0) {
            data.alternateOriginStreamIds = alternateStreamIds;
        }

        var requestWithoutCallback = _.bind(http.postWithRetry, http, this._backendUri + '/stream', JSON.stringify(data), defaultRequestOptions);

        return requestWithTimeout.call(this, requestWithoutCallback, callback);
    };

    AdminAPI.prototype.getStreams = function getStreams(callback) {
        var requestWithoutCallback = _.bind(http.getWithRetry, http, this._backendUri + '/streams', defaultRequestOptions);

        return requestWithTimeout.call(this, requestWithoutCallback, callback);
    };

    function requestWithTimeout(requestWithoutCallback, callback) {
        var requestTimeoutId = null;
        var requestDisposable = requestWithoutCallback(_.bind(handleResponse, this, function(error, response) {
            clearTimeout(requestTimeoutId);

            callback(error, response);
        }));

        requestTimeoutId = setTimeout(function() {
            requestDisposable.dispose();
            callback(new Error('timeout'));
        }, requestMaxTimeout);

        this._disposables.add(requestDisposable);
        this._disposables.add(new disposable.Disposable(function() {
            clearTimeout(requestTimeoutId);
        }));
    }

    function appendAuthDataTo(data) {
        return _.assign({}, data, this._authenticationData);
    }

    function handleResponse(callback, error, response) {
        if (error) {
            return callback(error, {});
        }

        var res = JSON.parse(response.data);

        if (res.status !== 'ok') {
            return callback(null, {status: res.status});
        }

        return callback(null, res);
    }

    return AdminAPI;
});