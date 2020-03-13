import _ from 'lodash';

import withinEnvelope from './helpers/withinEnvelope';
import htmlEntities from './helpers/htmlEntities';
import xml2js from './helpers/xml2js';
import xml2json from 'jquery-xml2json';
import requestHelper from './helpers/request';
import lowerCaseKeys from './helpers/lowerCaseKeys';

import Services from './helpers/Services';

const SONOS_PLAYER_DEFAULT_PORT = 1400;

/**
 * Constants
 */

const TRANSPORT_ENDPOINT = '/MediaRenderer/AVTransport/Control';
const RENDERING_ENDPOINT = '/MediaRenderer/RenderingControl/Control';
const GROUP_RENDERING_ENDPOINT = '/MediaRenderer/GroupRenderingControl/Control';
const DEVICE_ENDPOINT = '/DeviceProperties/Control';

const debug = function() {
    //console.log.apply(null, arguments);
};

class Sonos {
    /**
     * @param {String} host IP/DNS
     * @param {Number} port
     * @param {String} model
     */
    constructor(host, port, model) {
        this.host = host;
        this.port = port || SONOS_PLAYER_DEFAULT_PORT;
        this.model = model;
    }

    /**
     * UPnP HTTP Request
     * @param    {String}     endpoint        HTTP Path
     * @param    {String}     action            UPnP Call/Function/Action
     * @param    {String}     body
     * @param    {String}     responseTag Expected Response Container XML Tag
     * @param    {Function} callback        (err, data)
     */
    request(endpoint, action, body, responseTag, callback) {
        debug(
            'Sonos.request(%j, %j, %j, %j, %j)',
            endpoint,
            action,
            body,
            responseTag,
            callback
        );
        requestHelper(
            {
                uri: 'http://' + this.host + ':' + this.port + endpoint,
                method: 'POST',
                headers: {
                    SOAPAction: action,
                    'Content-type': 'text/xml; charset=utf8'
                },
                body: withinEnvelope(body)
            },
            function(err, res, body) {
                if (err) {
                    return callback(err);
                }
                if (res.statusCode !== 200) {
                    return callback(
                        new Error(
                            'HTTP response code ' +
                                res.statusCode +
                                ' for ' +
                                action
                        )
                    );
                }

                new xml2js.Parser().parseString(body, function(err, json) {
                    if (err) {
                        return callback(err);
                    }

                    if (
                        typeof json['s:Envelope']['s:Body'][0]['s:Fault'] !==
                        'undefined'
                    ) {
                        return callback(
                            json['s:Envelope']['s:Body'][0]['s:Fault']
                        );
                    }

                    return callback(
                        null,
                        json['s:Envelope']['s:Body'][0][responseTag]
                    );
                });
            }
        );
    }

    /**
     * Get Music Library Information
     * @param    {String}     searchType    Choice - artists, albumArtists, albums, genres, composers, tracks, playlists, share, or objectId
     * @param    {Object}     options         Opitional - default {start: 0, total: 100}
     * @param    {Function} callback (err, result) result - {returned: {String}, total: {String}, items:[{title:{String}, uri: {String}}]}
     */
    getMusicLibrary(searchType, options, callback) {
        const self = this;
        const searchTypes = {
            artists: 'A:ARTIST',
            albumArtists: 'A:ALBUMARTIST',
            albums: 'A:ALBUM',
            genres: 'A:GENRE',
            composers: 'A:COMPOSER',
            tracks: 'A:TRACKS',
            playlists: 'A:PLAYLISTS',
            queue: 'Q:0',
            share: 'S:'
        };

        const defaultOptions = {
            BrowseFlag: 'BrowseDirectChildren',
            Filter: '*',
            StartingIndex: '0',
            RequestedCount: '100',
            SortCriteria: ''
        };

        let opts = {
            ObjectID: [searchTypes[searchType] || searchType]
        };

        if (options.start !== undefined) {
            opts.StartingIndex = options.start;
        }
        if (options.total !== undefined) {
            opts.RequestedCount = options.total;
        }

        opts = _.extend(defaultOptions, opts);

        const contentDirectory = new Services.ContentDirectory(
            this.host,
            this.port
        );
        return contentDirectory.Browse(opts, function(err, data) {
            if (err) {
                return callback(err);
            }
            return new xml2js.Parser().parseString(data.Result, function(
                err,
                didl
            ) {
                if (err) {
                    return callback(err, data);
                }

                const items = [];

                if (!didl || !didl['DIDL-Lite']) {
                    callback(new Error('Cannot parse DIDL result'), data);
                }

                _.each(
                    didl['DIDL-Lite'].container || didl['DIDL-Lite'].item,
                    function(item) {
                        items.push({
                            id: item.$.id,
                            parentID: item.$.parentID,
                            title: Array.isArray(item['dc:title'])
                                ? item['dc:title'][0]
                                : null,
                            creator: Array.isArray(item['dc:creator'])
                                ? item['dc:creator'][0]
                                : null,
                            metadata: Array.isArray(item['r:resMD'])
                                ? self.parseDIDL(
                                      xml2json(item['r:resMD'][0], {
                                          explicitArray: true
                                      })
                                  )
                                : null,
                            metadataRaw: Array.isArray(item['r:resMD'])
                                ? item['r:resMD'][0]
                                : null,
                            album: Array.isArray(item['upnp:album'])
                                ? item['upnp:album'][0]
                                : null,
                            albumArtURI: Array.isArray(item['upnp:albumArtURI'])
                                ? item['upnp:albumArtURI'][0]
                                : null,
                            class: Array.isArray(item['upnp:class'])
                                ? item['upnp:class'][0]
                                : null,
                            originalTrackNumber: Array.isArray(
                                item['upnp:originalTrackNumber']
                            )
                                ? item['upnp:originalTrackNumber'][0]
                                : null,
                            uri: Array.isArray(item.res)
                                ? htmlEntities(item.res[0]._)
                                : null
                        });
                    }
                );

                const result = {
                    updateID: data.UpdateID,
                    returned: data.NumberReturned,
                    total: data.TotalMatches,
                    items: items
                };

                return callback(null, result);
            });
        });
    }

    /**
     * Get Music Library Information
     * @param    {String}    searchType    Choice - artists, albumArtists, albums, genres, composers, tracks, playlists, share
     * @param    {String}    searchTerm    search term to search for
     * @param    {Object}    options     Opitional - default {start: 0, total: 100}
     * @param    {Function}    callback (err, result) result - {returned: {String}, total: {String}, items:[{title:{String}, uri: {String}}]}
     */
    searchMusicLibrary(searchType, searchTerm, options, callback) {
        const self = this;
        const searchTypes = {
            artists: 'A:ARTIST',
            albumArtists: 'A:ALBUMARTIST',
            albums: 'A:ALBUM',
            genres: 'A:GENRE',
            composers: 'A:COMPOSER',
            tracks: 'A:TRACKS',
            playlists: 'A:PLAYLISTS',
            share: 'S:'
        };
        const defaultOptions = {
            BrowseFlag: 'BrowseDirectChildren',
            Filter: '*',
            StartingIndex: '0',
            RequestedCount: '100',
            SortCriteria: ''
        };

        const searches =
            (searchTypes[searchType] || searchType) + ':' + searchTerm;

        let opts = {
            ObjectID: searches
        };

        if (options.start !== undefined) {
            opts.StartingIndex = options.start;
        }
        if (options.total !== undefined) {
            opts.RequestedCount = options.total;
        }

        opts = _.extend(defaultOptions, opts);
        const contentDirectory = new Services.ContentDirectory(
            this.host,
            this.port
        );
        return contentDirectory.Browse(opts, function(err, data) {
            if (err) {
                return callback(err);
            }
            return new xml2js.Parser().parseString(data.Result, function(
                err,
                didl
            ) {
                if (err) {
                    return callback(err, data);
                }
                const items = [];
                if (!didl || !didl['DIDL-Lite']) {
                    callback(new Error('Cannot parse DIDL result'), data);
                }

                _.each(
                    didl['DIDL-Lite'].item || didl['DIDL-Lite'].container,
                    function(item) {
                        items.push({
                            title: Array.isArray(item['dc:title'])
                                ? item['dc:title'][0]
                                : null,
                            creator: Array.isArray(item['dc:creator'])
                                ? item['dc:creator'][0]
                                : null,
                            metadata: Array.isArray(item['r:resMD'])
                                ? self.parseDIDL(
                                      xml2json(item['r:resMD'][0], {
                                          explicitArray: true
                                      })
                                  )
                                : null,
                            metadataRaw: Array.isArray(item['r:resMD'])
                                ? item['r:resMD'][0]
                                : null,
                            album: Array.isArray(item['upnp:album'])
                                ? item['upnp:album'][0]
                                : null,
                            albumArtURI: Array.isArray(item['upnp:albumArtURI'])
                                ? item['upnp:albumArtURI'][0]
                                : null,
                            class: Array.isArray(item['upnp:class'])
                                ? item['upnp:class'][0]
                                : null,
                            originalTrackNumber: Array.isArray(
                                item['upnp:originalTrackNumber']
                            )
                                ? item['upnp:originalTrackNumber'][0]
                                : null,
                            uri: Array.isArray(item.res)
                                ? htmlEntities(item.res[0]._)
                                : null
                        });
                    }
                );
                const result = {
                    returned: data.NumberReturned,
                    total: data.TotalMatches,
                    items: items
                };
                return callback(null, result);
            });
        });
    }

    /**
     * Get Current Track
     * @param    {Function} callback (err, track)
     */
    currentTrack(callback) {
        debug('Sonos.currentTrack(' + (callback ? 'callback' : '') + ')');

        const action =
            '"urn:schemas-upnp-org:service:AVTransport:1#GetPositionInfo"';
        const body =
            '<u:GetPositionInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><Channel>Master</Channel></u:GetPositionInfo>';
        const responseTag = 'u:GetPositionInfoResponse';

        return this.request(
            TRANSPORT_ENDPOINT,
            action,
            body,
            responseTag,
            (err, data) => {
                if (err) {
                    return callback(err);
                }

                if (!Array.isArray(data) || data.length < 1) {
                    return {};
                }

                const metadata = data[0].TrackMetaData[0];
                const position =
                    parseInt(data[0].RelTime[0].split(':')[0], 10) * 60 * 60 +
                    parseInt(data[0].RelTime[0].split(':')[1], 10) * 60 +
                    parseInt(data[0].RelTime[0].split(':')[2], 10);

                const duration =
                    parseInt(data[0].TrackDuration[0].split(':')[0], 10) *
                        60 *
                        60 +
                    parseInt(data[0].TrackDuration[0].split(':')[1], 10) * 60 +
                    parseInt(data[0].TrackDuration[0].split(':')[2], 10);

                if (metadata && metadata !== 'NOT_IMPLEMENTED') {
                    return new xml2js.Parser().parseString(
                        metadata,
                        (err, data) => {
                            if (err) {
                                return callback(err, data);
                            }

                            const track = this.parseDIDL(data);
                            track.position = position;
                            track.duration = duration;
                            track.albumArtURL = !track.albumArtURI
                                ? null
                                : track.albumArtURI.indexOf('http') !== -1
                                ? track.albumArtURI
                                : 'http://' +
                                  this.host +
                                  ':' +
                                  this.port +
                                  track.albumArtURI;

                            return callback(null, track);
                        }
                    );
                } else {
                    return callback(null, {
                        position: position || 0,
                        duration: duration || 0
                    });
                }
            }
        );
    }

    /**
     * Parse DIDL into track structure
     * @param    {String} didl
     * @return    {object}
     */
    parseDIDL(didl) {
        if (
            !didl ||
            didl === '' ||
            !didl['DIDL-Lite'] ||
            !Array.isArray(didl['DIDL-Lite'].item) ||
            !didl['DIDL-Lite'].item[0]
        ) {
            return {};
        }
        const item = didl['DIDL-Lite'].item[0];
        return {
            title: Array.isArray(item['dc:title']) ? item['dc:title'][0] : null,
            artist: Array.isArray(item['dc:creator'])
                ? item['dc:creator'][0]
                : null,
            album: Array.isArray(item['upnp:album'])
                ? item['upnp:album'][0]
                : null,
            class: Array.isArray(item['upnp:class'])
                ? item['upnp:class'][0]
                : null,
            albumArtURI: Array.isArray(item['upnp:albumArtURI'])
                ? item['upnp:albumArtURI'][0]
                : null,
            originalTrackNumber: Array.isArray(item['upnp:originalTrackNumber'])
                ? item['upnp:originalTrackNumber'][0]
                : null
        };
    }

    /**
     * Get Current Volume
     * @param    {Function} callback (err, volume)
     */
    getVolume(callback) {
        debug('Sonos.getVolume(' + (callback ? 'callback' : '') + ')');

        const action =
            '"urn:schemas-upnp-org:service:RenderingControl:1#GetVolume"';
        const body =
            '<u:GetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID><Channel>Master</Channel></u:GetVolume>';
        const responseTag = 'u:GetVolumeResponse';

        return this.request(
            RENDERING_ENDPOINT,
            action,
            body,
            responseTag,
            function(err, data) {
                if (err) {
                    return callback(err);
                }

                callback(null, parseInt(data[0].CurrentVolume[0], 10));
            }
        );
    }

    /**
     * Get Current Muted
     * @param    {Function} callback (err, muted)
     */
    getMuted(callback) {
        debug('Sonos.getMuted(' + (callback ? 'callback' : '') + ')');

        const action =
            '"urn:schemas-upnp-org:service:RenderingControl:1#GetMute"';
        const body =
            '<u:GetMute xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID><Channel>Master</Channel></u:GetMute>';
        const responseTag = 'u:GetMuteResponse';

        return this.request(
            RENDERING_ENDPOINT,
            action,
            body,
            responseTag,
            function(err, data) {
                if (err) {
                    return callback(err);
                }

                callback(
                    null,
                    parseInt(data[0].CurrentMute[0], 10) ? true : false
                );
            }
        );
    }

    /**
     * Get Current Muted
     * @param    {Function} callback (err, muted)
     */
    getGroupMuted(callback) {
        debug('Sonos.getMuted(' + (callback ? 'callback' : '') + ')');

        const action =
            '"urn:schemas-upnp-org:service:GroupRenderingControl:1#GetGroupMute"';
        const body =
            '<u:GetGroupMute xmlns:u="urn:schemas-upnp-org:service:GroupRenderingControl:1"><InstanceID>0</InstanceID><Channel>Master</Channel></u:GetGroupMute>';
        const responseTag = 'u:GetGroupMuteResponse';

        return this.request(
            GROUP_RENDERING_ENDPOINT,
            action,
            body,
            responseTag,
            function(err, data) {
                if (err) {
                    return callback(err);
                }

                callback(
                    null,
                    parseInt(data[0].CurrentMute[0], 10) ? true : false
                );
            }
        );
    }

    /**
     * Resumes Queue or Plays Provided URI
     * @param    {String|Object}     uri            Optional - URI to a Audio Stream or Object with play options
     * @param    {Function} callback (err, playing)
     */
    play(uri, callback) {
        debug('Sonos.play(%j, %j)', uri, callback);

        const cb =
            (typeof uri === 'function' ? uri : callback) || function() {};
        const options = typeof uri === 'object' ? uri : {};
        if (typeof uri === 'object') {
            options.uri = uri.uri;
            options.metadata = uri.metadata;
        } else {
            options.uri = typeof uri === 'string' ? uri : undefined;
        }

        if (options.uri) {
            return this.queueNext(
                {
                    uri: options.uri,
                    metadata: options.metadata
                },
                err => {
                    if (err) {
                        return cb(err);
                    }
                    return this.play(cb);
                }
            );
        } else {
            const action = '"urn:schemas-upnp-org:service:AVTransport:1#Play"';
            const body =
                '<u:Play xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><Speed>1</Speed></u:Play>';
            return this.request(
                TRANSPORT_ENDPOINT,
                action,
                body,
                'u:PlayResponse',
                function(err, data) {
                    if (err) {
                        return cb(err);
                    }

                    if (
                        data[0].$['xmlns:u'] ===
                        'urn:schemas-upnp-org:service:AVTransport:1'
                    ) {
                        return cb(null, true);
                    } else {
                        return cb(
                            new Error({
                                err: err,
                                data: data
                            }),
                            false
                        );
                    }
                }
            );
        }
    }

    /**
     * Stop What's Playing
     * @param    {Function} callback (err, stopped)
     */
    stop(callback) {
        debug('Sonos.stop(%j)', callback);
        const action = '"urn:schemas-upnp-org:service:AVTransport:1#Stop"';
        const body =
            '<u:Stop xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><Speed>1</Speed></u:Stop>';
        return this.request(
            TRANSPORT_ENDPOINT,
            action,
            body,
            'u:StopResponse',
            function(err, data) {
                if (err) {
                    return callback(err);
                }

                if (
                    data[0].$['xmlns:u'] ===
                    'urn:schemas-upnp-org:service:AVTransport:1'
                ) {
                    return callback(null, true);
                } else {
                    return callback(
                        new Error({
                            err: err,
                            data: data
                        }),
                        false
                    );
                }
            }
        );
    }

    /**
     * Pause Current Queue
     * @param    {Function} callback (err, paused)
     */
    pause(callback) {
        debug('Sonos.pause(%j)', callback);
        const action = '"urn:schemas-upnp-org:service:AVTransport:1#Pause"';
        const body =
            '<u:Pause xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><Speed>1</Speed></u:Pause>';
        return this.request(
            TRANSPORT_ENDPOINT,
            action,
            body,
            'u:PauseResponse',
            function(err, data) {
                if (err) {
                    return callback(err);
                }

                if (
                    data[0].$['xmlns:u'] ===
                    'urn:schemas-upnp-org:service:AVTransport:1'
                ) {
                    return callback(null, true);
                } else {
                    return callback(
                        new Error({
                            err: err,
                            data: data
                        }),
                        false
                    );
                }
            }
        );
    }

    /**
     * Goto track no
     * @param    {Function} callback (err, seeked)
     */
    goto(trackNumber, callback) {
        this.selectTrack.call(this, trackNumber, callback);
    }

    /**
     * Seek the current track
     * @param    {Function} callback (err, seeked)
     */
    seek(seconds, callback) {
        debug('Sonos.seek(%j)', callback);
        let hh, mm, ss;

        hh = Math.floor(seconds / 3600);
        mm = Math.floor((seconds - hh * 3600) / 60);
        ss = seconds - (hh * 3600 + mm * 60);
        if (hh < 10) {
            hh = '0' + hh;
        }
        if (mm < 10) {
            mm = '0' + mm;
        }
        if (ss < 10) {
            ss = '0' + ss;
        }

        const action = '"urn:schemas-upnp-org:service:AVTransport:1#Seek"';
        const body =
            '<u:Seek xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>' +
            hh +
            ':' +
            mm +
            ':' +
            ss +
            '</Target></u:Seek>';
        return this.request(
            TRANSPORT_ENDPOINT,
            action,
            body,
            'u:SeekResponse',
            function(err, data) {
                if (err) {
                    return callback(err);
                }

                if (
                    data[0].$['xmlns:u'] ===
                    'urn:schemas-upnp-org:service:AVTransport:1'
                ) {
                    return callback(null, true);
                } else {
                    return callback(
                        new Error({
                            err: err,
                            data: data
                        }),
                        false
                    );
                }
            }
        );
    }

    /**
     * Select specific track in queue
     * @param    {Number}     trackNr        Number of track in queue (optional, indexed from 1)
     * @param    {Function} callback (err, data)
     */
    selectTrack(trackNr, callback) {
        if (typeof trackNr === 'function') {
            callback = trackNr;
            trackNr = 1;
        }

        const action = '"urn:schemas-upnp-org:service:AVTransport:1#Seek"';
        const body =
            '<u:Seek xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><Unit>TRACK_NR</Unit><Target>' +
            trackNr +
            '</Target></u:Seek>';

        return this.request(
            TRANSPORT_ENDPOINT,
            action,
            body,
            'u:SeekResponse',
            function(err, data) {
                if (err) {
                    return callback(err);
                }

                if (
                    data[0].$['xmlns:u'] ===
                    'urn:schemas-upnp-org:service:AVTransport:1'
                ) {
                    return callback(null, true);
                } else {
                    return callback(
                        new Error({
                            err: err,
                            data: data
                        }),
                        false
                    );
                }
            }
        );
    }

    /**
     * Play next in queue
     * @param    {Function} callback (err, movedToNext)
     */
    next(callback) {
        debug('Sonos.next(%j)', callback);
        const action = '"urn:schemas-upnp-org:service:AVTransport:1#Next"';
        const body =
            '<u:Next xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><Speed>1</Speed></u:Next>';
        this.request(
            TRANSPORT_ENDPOINT,
            action,
            body,
            'u:NextResponse',
            function(err, data) {
                if (err) {
                    return callback(err);
                }
                if (
                    data[0].$['xmlns:u'] ===
                    'urn:schemas-upnp-org:service:AVTransport:1'
                ) {
                    return callback(null, true);
                } else {
                    return callback(
                        new Error({
                            err: err,
                            data: data
                        }),
                        false
                    );
                }
            }
        );
    }

    /**
     * Play previous in queue
     * @param    {Function} callback (err, movedToPrevious)
     */
    previous(callback) {
        debug('Sonos.previous(%j)', callback);
        const action = '"urn:schemas-upnp-org:service:AVTransport:1#Previous"';
        const body =
            '<u:Previous xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><Speed>1</Speed></u:Previous>';
        this.request(
            TRANSPORT_ENDPOINT,
            action,
            body,
            'u:PreviousResponse',
            function(err, data) {
                if (err) {
                    return callback(err);
                }
                if (
                    data[0].$['xmlns:u'] ===
                    'urn:schemas-upnp-org:service:AVTransport:1'
                ) {
                    return callback(null, true);
                } else {
                    return callback(
                        new Error({
                            err: err,
                            data: data
                        }),
                        false
                    );
                }
            }
        );
    }

    /**
     * Select Queue. Mostly required after turning on the speakers otherwise play, setPlaymode and other commands will fail.
     * @param    {Function}    callback (err, data)    Optional
     */
    selectQueue(callback) {
        debug('Sonos.selectQueue(%j)', callback);
        const cb = callback || function() {};
        const self = this;
        self.getZoneInfo(function(err, data) {
            if (!err) {
                const action =
                    '"urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI"';
                const body =
                    '<u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><CurrentURI>' +
                    'x-rincon-queue:RINCON_' +
                    data.MACAddress.replace(/:/g, '') +
                    '0' +
                    self.port +
                    '#0</CurrentURI><CurrentURIMetaData></CurrentURIMetaData></u:SetAVTransportURI>';
                self.request(
                    TRANSPORT_ENDPOINT,
                    action,
                    body,
                    'u:SetAVTransportURIResponse',
                    function(err, data) {
                        if (err) {
                            return cb(err);
                        }
                        if (
                            data[0].$['xmlns:u'] ===
                            'urn:schemas-upnp-org:service:AVTransport:1'
                        ) {
                            return cb(null, true);
                        } else {
                            return cb(
                                new Error({
                                    err: err,
                                    data: data
                                }),
                                false
                            );
                        }
                    }
                );
            } else {
                return cb(err);
            }
        });
    }

    /**
     * Queue a Song Next
     * @param    {String|Object}     uri            URI to Audio Stream or Object containing options (uri, metadata)
     * @param    {Function} callback (err, queued)
     */
    queueNext(uri, callback) {
        debug('Sonos.queueNext(%j, %j)', uri, callback);

        const options = typeof uri === 'object' ? uri : { metadata: '' };
        if (typeof uri === 'object') {
            options.metadata = uri.metadata || '';
            options.metadata = htmlEntities(options.metadata);
            options.uri = uri.uri;
        } else {
            options.uri = uri;
        }

        const action =
            '"urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI"';
        const body =
            '<u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><CurrentURI>' +
            options.uri +
            '</CurrentURI><CurrentURIMetaData>' +
            options.metadata +
            '</CurrentURIMetaData></u:SetAVTransportURI>';
        this.request(
            TRANSPORT_ENDPOINT,
            action,
            body,
            'u:SetAVTransportURIResponse',
            function(err, data) {
                if (callback) {
                    return callback(err, data);
                } else {
                    return null;
                }
            }
        );
    }

    /**
     * Add a song to the queue.
     * @param    {String}     uri             URI to Audio Stream
     * @param    {Number}     positionInQueue Position in queue at which to add song (optional, indexed from 1,
     *                                    defaults to end of queue, 0 to explicitly set end of queue)
     * @param    {Function} callback (err, queued)
     */
    queue(uri, positionInQueue, callback) {
        debug('Sonos.queue(%j, %j, %j)', uri, positionInQueue, callback);
        if (typeof positionInQueue === 'function') {
            callback = positionInQueue;
            positionInQueue = 0;
        }
        const options = typeof uri === 'object' ? uri : { metadata: '' };
        if (typeof uri === 'object') {
            options.metadata = uri.metadata || '';
            options.metadata = htmlEntities(options.metadata);
            options.uri = uri.uri;
        } else {
            options.uri = uri;
        }
        const action =
            '"urn:schemas-upnp-org:service:AVTransport:1#AddURIToQueue"';
        const body =
            '<u:AddURIToQueue xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><EnqueuedURI>' +
            options.uri +
            '</EnqueuedURI><EnqueuedURIMetaData>' +
            options.metadata +
            '</EnqueuedURIMetaData><DesiredFirstTrackNumberEnqueued>' +
            positionInQueue +
            '</DesiredFirstTrackNumberEnqueued><EnqueueAsNext>1</EnqueueAsNext></u:AddURIToQueue>';
        this.request(
            TRANSPORT_ENDPOINT,
            action,
            body,
            'u:AddURIToQueueResponse',
            function(err, data) {
                return callback(err, data);
            }
        );
    }

    /**
     * Flush queue
     * @param    {Function} callback (err, flushed)
     */
    flush(callback) {
        debug('Sonos.flush(%j)', callback);
        const action =
            '"urn:schemas-upnp-org:service:AVTransport:1#RemoveAllTracksFromQueue"';
        const body =
            '<u:RemoveAllTracksFromQueue xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID></u:RemoveAllTracksFromQueue>';
        this.request(
            TRANSPORT_ENDPOINT,
            action,
            body,
            'u:RemoveAllTracksFromQueueResponse',
            function(err, data) {
                return callback(err, data);
            }
        );
    }

    /**
     * Get the LED State
     * @param    {Function} callback (err, state) state is a string, "On" or "Off"
     */
    getLEDState(callback) {
        debug('Sonos.getLEDState(%j)', callback);
        const action =
            '"urn:schemas-upnp-org:service:DeviceProperties:1#GetLEDState"';
        const body =
            '<u:GetLEDState xmlns:u="urn:schemas-upnp-org:service:DeviceProperties:1"></u:GetLEDState>';
        this.request(
            DEVICE_ENDPOINT,
            action,
            body,
            'u:GetLEDStateResponse',
            function(err, data) {
                if (err) {
                    return callback(err, data);
                }
                if (
                    data[0] &&
                    data[0].CurrentLEDState &&
                    data[0].CurrentLEDState[0]
                ) {
                    return callback(null, data[0].CurrentLEDState[0]);
                }
                callback(new Error('unknown response'));
            }
        );
    }

    /**
     * Set the LED State
     * @param    {String}     desiredState                     "On"/"Off"
     * @param    {Function} callback (err)
     */
    setLEDState(desiredState, callback) {
        debug('Sonos.setLEDState(%j, %j)', desiredState, callback);
        const action =
            '"urn:schemas-upnp-org:service:DeviceProperties:1#SetLEDState"';
        const body =
            '<u:SetLEDState xmlns:u="urn:schemas-upnp-org:service:DeviceProperties:1"><DesiredLEDState>' +
            desiredState +
            '</DesiredLEDState></u:SetLEDState>';
        this.request(
            DEVICE_ENDPOINT,
            action,
            body,
            'u:SetLEDStateResponse',
            function(err) {
                return callback(err);
            }
        );
    }

    /**
     * Get Zone Info
     * @param    {Function} callback (err, info)
     */
    getZoneInfo(callback) {
        debug('Sonos.getZoneInfo(%j)', callback);
        const action =
            '"urn:schemas-upnp-org:service:DeviceProperties:1#GetZoneInfo"';
        const body =
            '<u:GetZoneInfo xmlns:u="urn:schemas-upnp-org:service:DeviceProperties:1"></u:GetZoneInfo>';
        this.request(
            DEVICE_ENDPOINT,
            action,
            body,
            'u:GetZoneInfoResponse',
            function(err, data) {
                if (err) {
                    return callback(err, data);
                }

                const output = {};
                for (const d in data[0]) {
                    if (data[0].hasOwnProperty(d) && d !== '$') {
                        output[d] = data[0][d][0];
                    }
                }
                callback(null, output);
            }
        );
    }

    /**
     * Get Zone Attributes
     * @param    {Function} callback (err, data)
     */
    getZoneAttrs(callback) {
        debug('Sonos.getZoneAttrs(%j, %j)', callback);

        const action =
            '"urn:schemas-upnp-org:service:DeviceProperties:1#GetZoneAttributes"';
        const body =
            '"<u:GetZoneAttributes xmlns:u="urn:schemas-upnp-org:service:DeviceProperties:1"></u:SetZoneAttributes>"';
        this.request(
            DEVICE_ENDPOINT,
            action,
            body,
            'u:GetZoneAttributesResponse',
            function(err, data) {
                if (err) {
                    return callback(err, data);
                }

                const output = {};
                for (const d in data[0]) {
                    if (data[0].hasOwnProperty(d) && d !== '$') {
                        output[d] = data[0][d][0];
                    }
                }
                callback(null, output);
            }
        );
    }

    /**
     * Get Information provided by /xml/device_description.xml
     * @param    {Function} callback (err, info)
     */
    deviceDescription(callback) {
        requestHelper(
            {
                uri:
                    'http://' +
                    this.host +
                    ':' +
                    this.port +
                    '/xml/device_description.xml'
            },
            function(err, res, body) {
                if (err) {
                    return callback(err);
                }
                if (res.statusCode !== 200) {
                    return callback(new Error('non 200 errorCode'));
                }
                new xml2js.Parser().parseString(body, function(err, json) {
                    if (err) {
                        return callback(err);
                    }
                    const output = {};
                    for (const d in json.root.device[0]) {
                        if (json.root.device[0].hasOwnProperty(d)) {
                            output[d] = json.root.device[0][d][0];
                        }
                    }
                    callback(null, output);
                });
            }
        );
    }

    /**
     * Set Name
     * @param    {String}     name
     * @param    {Function} callback (err, data)
     */
    setName(name, callback) {
        debug('Sonos.setName(%j, %j)', name, callback);
        name = name.replace(/[<&]/g, function(str) {
            return str === '&' ? '&amp;' : '&lt;';
        });
        const action =
            '"urn:schemas-upnp-org:service:DeviceProperties:1#SetZoneAttributes"';
        const body =
            '"<u:SetZoneAttributes xmlns:u="urn:schemas-upnp-org:service:DeviceProperties:1"><DesiredZoneName>' +
            name +
            '</DesiredZoneName><DesiredIcon /><DesiredConfiguration /></u:SetZoneAttributes>"';
        this.request(
            DEVICE_ENDPOINT,
            action,
            body,
            'u:SetZoneAttributesResponse',
            function(err, data) {
                return callback(err, data);
            }
        );
    }

    /**
     * Set Play Mode
     * @param    {String}
     * @param    {Function} callback (err, data)
     * @return {[type]}
     */
    setPlayMode(playmode, callback) {
        debug('Sonos.setPlayMode(%j, %j)', playmode, callback);
        const mode = {
            NORMAL: true,
            REPEAT_ALL: true,
            SHUFFLE: true,
            SHUFFLE_NOREPEAT: true
        }[playmode.toUpperCase()];
        if (!mode) {
            return callback(new Error('invalid play mode ' + playmode));
        }
        const action =
            '"urn:schemas-upnp-org:service:AVTransport:1#SetPlayMode"';
        const body =
            '<u:SetPlayMode xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><NewPlayMode>' +
            playmode.toUpperCase() +
            '</NewPlayMode></u:SetPlayMode>';
        this.request(
            TRANSPORT_ENDPOINT,
            action,
            body,
            'u:SetPlayModeResponse',
            function(err, data) {
                return callback(err, data);
            }
        );
    }

    /**
     * Set Volume
     * @param    {String}     volume 0..100
     * @param    {Function} callback (err, data)
     * @return {[type]}
     */
    setVolume(volume, callback) {
        debug('Sonos.setVolume(%j, %j)', volume, callback);
        const action =
            '"urn:schemas-upnp-org:service:RenderingControl:1#SetVolume"';
        const body =
            '<u:SetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>' +
            volume +
            '</DesiredVolume></u:SetVolume>';
        this.request(
            RENDERING_ENDPOINT,
            action,
            body,
            'u:SetVolumeResponse',
            function(err, data) {
                return callback(err, data);
            }
        );
    }

    /**
     * Set Muted
     * @param    {Boolean}    muted
     * @param    {Function} callback (err, data)
     * @return {[type]}
     */
    setMuted(muted, callback) {
        debug('Sonos.setMuted(%j, %j)', muted, callback);
        if (typeof muted === 'string') {
            muted = parseInt(muted, 10) ? true : false;
        }
        const action =
            '"urn:schemas-upnp-org:service:RenderingControl:1#SetMute"';
        const body =
            '<u:SetMute xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>' +
            (muted ? '1' : '0') +
            '</DesiredMute></u:SetMute>';
        this.request(
            RENDERING_ENDPOINT,
            action,
            body,
            'u:SetMuteResponse',
            function(err, data) {
                return callback(err, data);
            }
        );
    }

    /**
     * Set GroupMuted
     * @param    {Boolean}    muted
     * @param    {Function} callback (err, data)
     * @return {[type]}
     */
    setGroupMuted(muted, callback) {
        debug('Sonos.setGroupMuted(%j, %j)', muted, callback);
        if (typeof muted === 'string') {
            muted = parseInt(muted, 10) ? true : false;
        }

        const action =
            '"urn:schemas-upnp-org:service:GroupRenderingControl:1#SetGroupMute"';
        const body =
            '<u:SetGroupMute xmlns:u="urn:schemas-upnp-org:service:GroupRenderingControl:1"><InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>' +
            (muted ? '1' : '0') +
            '</DesiredMute></u:SetMute>';
        this.request(
            GROUP_RENDERING_ENDPOINT,
            action,
            body,
            'u:SetGroupMuteResponse',
            function(err, data) {
                return callback(err, data);
            }
        );
    }

    /**
     * Get Zones in contact with current Zone with Group Data
     * @param    {Function} callback (err, topology)
     */
    getTopology(callback) {
        debug('Sonos.getTopology(%j)', callback);

        const topologyService = new Services.ZoneGroupTopology(
            this.host,
            this.port
        );

        topologyService.GetZoneGroupState(
            {
                InstanceID: 0
            },
            function(err, data) {
                if (err) {
                    return reject(err);
                }

                const body = data.ZoneGroupState;

                new xml2js.Parser().parseString(body, function(err, info) {
                    debug('Sonos.getTopology(%j) result', err, info);

                    const zones = [];

                    for (const zg of info.ZoneGroupState.ZoneGroups[0]
                        .ZoneGroup) {
                        const coordinatorID = zg.$.Coordinator;

                        for (const m of zg.ZoneGroupMember) {
                            zones.push({
                                coordinator:
                                    m.$.UUID === coordinatorID
                                        ? 'true'
                                        : 'false',
                                group: zg.$.ID,
                                name: m.$.ZoneName,
                                ...lowerCaseKeys(m.$)
                            });
                        }
                    }

                    callback(null, {
                        zones: zones
                    });
                });
            }
        );
    }

    /**
     * Gets accountd data for Player
     * @param    {Function} callback (err, data)
     */
    getAccountStatus(callback) {
        debug('Sonos.getAccountStatus(%j)', callback);
        requestHelper(
            'http://' + this.host + ':' + this.port + '/status/accounts',
            function(err, res, body) {
                if (err) {
                    return callback(err);
                }
                debug(body);
                new xml2js.Parser().parseString(body, function(err, data) {
                    if (err) {
                        return callback(err);
                    }

                    let accounts = [];

                    if (
                        data.ZPSupportInfo &&
                        data.ZPSupportInfo.Accounts &&
                        data.ZPSupportInfo.Accounts[0].Account
                    ) {
                        accounts = data.ZPSupportInfo.Accounts[0].Account.map(
                            a => {
                                return _.extend(
                                    a.$,
                                    {
                                        Username: a.UN[0]
                                    },
                                    {
                                        Key: _.get(a, 'Key.0')
                                    }
                                );
                            }
                        );
                    }
                    callback(null, accounts);
                });
            }
        );
    }

    /**
     * Gets household ID
     * @param    {Function} callback (err, data)
     */
    getHouseholdId(callback) {
        debug('Sonos.getHouseholdId(%j)', callback);
        requestHelper(
            'http://' + this.host + ':' + this.port + '/status/zp',
            function(err, res, body) {
                if (err) {
                    return callback(err);
                }
                debug(body);
                new xml2js.Parser().parseString(body, function(err, data) {
                    if (err) {
                        return callback(err);
                    }

                    callback(
                        null,
                        data.ZPSupportInfo.ZPInfo[0].HouseholdControlID[0]
                    );
                });
            }
        );
    }

    /**
     * Get Current Playback State
     * @param    {Function} callback (err, state)
     */
    getCurrentState(callback) {
        debug('Sonos.currentState(%j)', callback);
        const _this = this;
        const action =
            '"urn:schemas-upnp-org:service:AVTransport:1#GetTransportInfo"';
        const body =
            '<u:GetTransportInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID></u:GetTransportInfo>';
        let state = null;

        return this.request(
            TRANSPORT_ENDPOINT,
            action,
            body,
            'u:GetTransportInfoResponse',
            function(err, data) {
                if (err) {
                    callback(err);
                    return;
                }

                state = _this.translateState(data[0].CurrentTransportState[0]);

                return callback(err, state);
            }
        );
    }

    /**
     * Get Current Position Info
     * @param    {Function} callback (err, info)
     */
    getPositionInfo(callback) {
        debug('Sonos.positionInfo(%j)', callback);

        const avTransport = new Services.AVTransport(this.host, this.port);

        avTransport.GetPositionInfo(
            {
                InstanceID: 0
            },
            function(err, data) {
                callback(err, data);
            }
        );
    }

    /**
     * Get Current Media Info
     * @param    {Function} callback (err, info)
     */
    getMediaInfo(callback) {
        debug('Sonos.positionInfo(%j)', callback);

        const avTransport = new Services.AVTransport(this.host, this.port);

        avTransport.GetMediaInfo(
            {
                InstanceID: 0
            },
            function(err, data) {
                callback(err, data);
            }
        );
    }

    /**
     * @param {String}
     */
    translateState(inputState) {
        switch (inputState) {
            case 'PAUSED_PLAYBACK':
                return 'paused';

            default:
                return inputState.toLowerCase();
        }
    }

    getAvailableServices(callback) {
        new Services.MusicServices(this.host).ListAvailableServices(
            {},
            async (err, data) => {
                if (err) {
                    callback(err);
                    return;
                }

                const servicesObj = xml2json(
                    data.AvailableServiceDescriptorList,
                    {
                        explicitArray: true
                    }
                );

                const serviceDescriptors = servicesObj.Services.Service.map(
                    obj => {
                        const stringsUri = _.get(
                            obj,
                            'Presentation.0.Strings.0.$.Uri'
                        );
                        const mapUri = _.get(
                            obj,
                            'Presentation.0.PresentationMap.0.$.Uri'
                        );
                        const manifestUri = _.get(obj, 'Manifest.0.$.Uri');

                        return _.assign({}, obj.$, obj.Policy[0].$, {
                            manifestUri,
                            presentation: {
                                stringsUri,
                                mapUri
                            }
                        });
                    }
                );

                const services = [];

                data.AvailableServiceTypeList.split(',').forEach(async t => {
                    const serviceId =
                        Math.floor(Math.abs((t - 7) / 256)) || Number(t);
                    const match = _.find(serviceDescriptors, {
                        Id: String(serviceId)
                    });

                    if (match) {
                        match.ServiceIDEncoded = Number(t);
                        services.push(match);
                    }
                });

                console.log('Available services', services);
                callback(null, services);
            }
        );
    }
}

export default Sonos;
