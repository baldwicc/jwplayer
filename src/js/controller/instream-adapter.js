define([
    'controller/instream-html5',
    'controller/instream-flash',
    'view/adskipbutton',
    'events/events',
    'events/states',
    'utils/helpers',
    'utils/backbone.events',
    'utils/underscore'
], function(InstreamHtml5, InstreamFlash, AdSkipButton, events, states, utils, Events, _) {

    function chooseInstreamMethod(_model) {
        var providerName = _model.get('provider').name || '';
        if (providerName.indexOf('flash') >= 0) {
            return InstreamFlash;
        }

        return InstreamHtml5;
    }

    var _defaultOptions = {
        skipoffset: null,
        tag: null
    };

    var InstreamAdapter = function(_controller, _model, _view) {

        var InstreamMethod = chooseInstreamMethod(_model);
        var _instream = new InstreamMethod(_controller, _model);

        var _array, // the copied in playlist
            _arrayOptions,
            _arrayIndex = 0,
            _options = {},
            _oldProvider,
            _oldpos,
            _oldstate,
            _olditem,
            _this = this;

        this.type = 'instream';

        this.init = function() {

            // Keep track of the original player state
            _oldProvider = _model.getVideo();
            _oldpos = _model.position;
            _olditem = _model.playlist[_model.item];


            _instream.on('all', _instreamForward, this);
            _instream.on(events.JWPLAYER_MEDIA_TIME, _instreamTime, this);
            _instream.on(events.JWPLAYER_MEDIA_COMPLETE, _instreamItemComplete, this);
            _instream.init();

            if (_controller.checkBeforePlay() || (_oldpos === 0 && !_oldProvider.checkComplete())) {
                // make sure video restarts after preroll
                _oldpos = 0;
                _oldstate = states.PLAYING;
            } else if (_oldProvider && _oldProvider.checkComplete()) {
                // AKA  postroll
                _oldstate = states.IDLE;
            } else if (_model.get('state') === states.IDLE) {
                _oldstate = states.IDLE;
            } else {
                _oldstate = states.PLAYING;
            }
            // If the player's currently playing, pause the video tag
            if (_oldstate === states.PLAYING) {
                // pause must be called before detachMedia
                _oldProvider.pause();
            }
            // Make sure the original player's provider stops broadcasting events (pseudo-lock...)
            _oldProvider.detachMedia();

            // Show instream state instead of normal player state
            _view.setupInstream(_instream._adModel);

            this.setText('Loading ad');
            return this;
        };

        function _instreamForward(type, data) {
            data = data || {};

            if (_options.tag && !data.tag) {
                data.tag = _options.tag;
            }

            this.trigger(type, data);
        }

        function _instreamTime(evt) {
            if (_this._skipButton) {
                _this._skipButton.updateMediaTime(evt.position, evt.duration);
            }
        }

        function _instreamItemComplete() {
            if (_array && _arrayIndex + 1 < _array.length) {
                if (this._skipButton) {
                    this._skipButton.destroy();
                }

                _arrayIndex++;
                var item = _array[_arrayIndex];
                var options;
                if (_arrayOptions) {
                    options = _arrayOptions[_arrayIndex];
                }
                _this.loadItem(item, options);
            } else {
                _controller.instreamDestroy();
            }
        }

        this.loadItem = function(item, options) {
            if (utils.isAndroid(2.3)) {
                _this.trigger({
                    type: events.JWPLAYER_ERROR,
                    message: 'Error loading instream: Cannot play instream on Android 2.3'
                });
                return;
            }
            // Copy the playlist item passed in and make sure it's formatted as a proper playlist item
            if (_.isArray(item)) {
                _array = item;
                _arrayOptions = options;
                item = _array[_arrayIndex];
                if (_arrayOptions) {
                    options = _arrayOptions[_arrayIndex];
                }
            }

            _options = _.extend({}, _defaultOptions, options);
            _instream.load(item);

            this.addClickHandler();

            if (_options.skipoffset) {
                this._skipButton = new AdSkipButton(_options.skipMessage, _options.skipText);
                this._skipButton.on(events.JWPLAYER_AD_SKIPPED, this.skipAd, this);
                this._skipButton.setWaitTime(_options.skipoffset);

                _view.controlsContainer().appendChild(this._skipButton.element());
            }
        };

        this.play = function() {
            _instream.instreamPlay();
        };

        this.pause = function() {
            _instream.instreamPause();
        };

        this.hide = function() {
            _instream.hide();
        };

        this.addClickHandler = function() {
            // start listening for ad click
            _view.clickHandler().setAlternateClickHandler(function (evt) {
                evt = evt || {};
                evt.hasControls = !!_model.get('controls');

                _this.trigger(events.JWPLAYER_INSTREAM_CLICK, evt);

                // toggle playback after click event

                if (_instream._adModel.state === states.PAUSED) {
                    if (evt.hasControls) {
                        _instream.instreamPlay();
                    }
                } else {
                    _instream.instreamPause();
                }
            });

            //if (utils.isMSIE()) {
                //_oldProvider.parentElement.addEventListener('click', _view.clickHandler().clickHandler);
            //}

            _view.on(events.JWPLAYER_AD_SKIPPED, this.skipAd, this);
            _instream.on(events.JWPLAYER_MEDIA_META, this.metaHandler, this);

        };

        this.skipAd = function() {
            _instreamItemComplete();
        };


        /** Handle the JWPLAYER_MEDIA_META event **/
        this.metaHandler = function (evt) {
            // If we're getting video dimension metadata from the provider, allow the view to resize the media
            if (evt.width && evt.height) {
                _view.resizeMedia();
            }
        };

        this.destroy = function() {
            this.off();

            if (this._skipButton) {
                _view.controlsContainer().removeChild(this._skipButton.element());
                this._skipButton = null;
            }

            if (_instream) {
                if (_view.clickHandler()) {
                    //if (_oldProvider && _oldProvider.parentElement) {
                        //_oldProvider.parentElement.removeEventListener('click', _view.clickHandler().clickHandler);
                    //}
                    _view.clickHandler().revertAlternateClickHandler();
                }
                _instream.instreamDestroy();

                // Must happen after instream.instreamDestroy()
                _view.destroyInstream();


                _instream = null;

                // Re-attach the controller
                _controller.attachMedia();

                // Load the original item into our provider, which sets up the regular player's video tag
                //_oldProvider = _model.getVideo();

                if (_oldstate !== states.IDLE) {
                    var item = _.extend({}, _olditem);
                    item.starttime = _oldpos;
                    _model.loadVideo(item);

                } else {
                    _oldProvider.stop();
                }

                if (_oldstate === states.PLAYING) {
                    // Model was already correct; just resume playback
                    _oldProvider.play();
                }

            }
        };

        this.getState = function() {
            if (_instream && _instream._adModel) {
                return _instream._adModel.get('state');
            }
            // api expects false to know we aren't in instreamMode
            return false;
        };

        this.setText = function(text) {
            _view.setAltText(text ? text : '');
        };

        // This method is triggered by plugins which want to hide player controls
        this.hide = function() {
            _view.useExternalControls();
        };

    };

    _.extend(InstreamAdapter.prototype, Events);

    return InstreamAdapter;
});
