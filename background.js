/*globals chrome, webkitNotifications, console*/
/*jshint boss: true, debug:true, loopfunc:true, strict: true, expr: true */
//audio from http://www.freesound.org/people/steveygos93/
var nextcoinLive = (function (){
	"use strict";
	var global, connect,
		version = chrome.runtime.getManifest().version,
		settings            = {
			version            : void 0,
			tracker            : 'coinmarketcap',
			currency           : 'USD',
			crCode             : '$',
			httpFallBack       : true,
			httpWait           : 10000,
			badgeProp          : "last",
			avgReset           : 600,
			iframeUrl          : 'http://bitcoinity.org/markets',
			mute               : false,
			notify             : true,
			notificationTimeout: 5000,

			notifyTimeChange   : false,
			timeInt            : 120000, //time int to notify change
			timeValueChange    : 200000, //value change in microFiat 100,000 = 1 Fiat (usd, euro, etc)

			notifyPrecentChange: true,
			percentInt         : 120000, //time int to notify change
			percentValueChange : 0.05,  //(0.01 = 1%)

			valueDivider       : 1, //if we want to see value in miliBit microBit or any other divider.

			notifyMax          : false,
			maxValue           : 15000000, //max value in in microFiat.

			notifyMin          : false,
			minValue           : 14000000 //max value in in microFiat.
		},
		currencies          = {
			'USD': '$',
			'AUD': 'A$',
			'CAD': 'C$',
			'CHF': 'CHF',
			'CNY': 'C¥',
			'DKK': 'Kr',
			'EUR': '€',
			'ILS': '₪',
			'GBP': '£',
			'HKD': 'H$',
			'JPY': 'J¥',
			'NZD': 'N$',
			'PLN': 'zł',
			'RUB': 'руб',
			'SEK': 'Kr',
			'SGD': 'S$',
			'THB': '฿',
			'BRL': 'R$',
			'CZK': 'Kč',
			'NOK': 'kr',
			'ZAR': 'R'

		},
		average             = 0,
		avgCount            = 0,
		api                 = {
			
			
			coinmarketcap: {
				webSocketUrl      : '{0}',
				socketIoUrl       : '',
				httpApiUrl        : '',
				optionalProps     : ['last_all', 'avg', 'buy', 'sell', 'high', 'low', 'last', 'last_local', 'last_orig'],
				optionalCurrencies: ['USD', 'AUD', 'CAD', 'CHF', 'CNY', 'DKK', 'EUR', 'GBP', 'HKD', 'JPY', 'NZD', 'PLN', 'RUB', 'SEK', 'SGD', 'THB'],
				httpWait          : 10 * 1000,
				parseDataFunc     : function (data) {
					if (data.result === "success") {
						data['return'].now = window.parseInt(data['return'].now / 1000, 10);
						return data['return'];
					}
				}
			}
		},
		history             = {startTime: (new Date()).getTime(), all: [], min:Infinity, max: 0},
		audio               = new webkitAudioContext(),
		audioBuffer         = {},
		notID               = 1,
		emptyFunction       = function(){};



	function formatTime(t) {
		t = new Date(t);
		return t.getDate() + '/' + t.getMonth() + ' ' + t.getHours()+ ':' + t.getMinutes()+ ':' + t.getSeconds();

	}
	


	function parseHistoryVal (val) {
		return Math.round(val / (settings.valueDivider * 1000)) / 100;
	}

	function setHistory (param, time){
		var first, minMax, maxVal, minVal,
			recal = false,
			doReset = false,
			resetTime = time - settings.timeInt,
			//val = param.value_int;
			val = param;

		if (!val) { //we are ignoring 0 or no value since mtGox sometimes go crazy and we don't want to scare ppl :-D
			return;
		}
		time = time || (new Date()).getTime();
		
		if (doReset) {
			resetHistory(val, time);
		} else {
			history.min = Math.min(history.min, val);
			history.max = Math.max(history.max, val);
			history.all.push([val, time]);

			while(resetTime > history.all[0][1]) {
				first = history.all.shift();
				if (!recal && (first[0] === history.min || first[0] === history.max)) {
					recal = true;
				}
			}
			if (recal) {
				minMax = history.all.reduce(function(arr, item) {
					return [Math.min(arr[0], item[0]), Math.max(arr[1], item[0])];
				}, [Infinity, 0]);
				history.min = minMax[0];
				history.max = minMax[1];
			}
		}
	}

	function resetHistory(val, time){
		history.min = val || Infinity;
		history.max = val || 0;
		history.all = val ? [[val, time || 0]] : [];
	}

	function setBadge (param){
		var value = param,
		value_int = param;

		chrome.browserAction.setBadgeText({text: (value/ settings.valueDivider).toString() });
		chrome.browserAction.setBadgeBackgroundColor({color: value_int >= average ? '#0A0' : '#A00'});

		if (avgCount >= settings.avgReset) {
			average = value_int;
			avgCount = 1;
		} else {
			average = ((average * avgCount) + parseInt(value_int, 10)) / (avgCount + 1);
			avgCount += 1;
		}
		return;

		var value = param.value,
			value_int = param.value_int;

		chrome.browserAction.setBadgeText({text: (value/ settings.valueDivider).toString() });
		chrome.browserAction.setBadgeBackgroundColor({color: value_int >= average ? '#0A0' : '#A00'});

		if (avgCount >= settings.avgReset) {
			average = value_int;
			avgCount = 1;
		} else {
			average = ((average * avgCount) + parseInt(value_int, 10)) / (avgCount + 1);
			avgCount += 1;
		}
	}

	function setTitle (data){
		chrome.browserAction.setTitle({title: 'sell: ' + data.sell.display + ' buy: ' + data.buy.display});
	}

	function setData (data, time) {
		setBadge(data);
		setHistory(data, time);
		//setTitle(data);
		return;
		var param = data[settings.badgeProp];
		setBadge(param);
		setHistory(param, time);
		setTitle(data);
	}

	function getUrlCurrency (url, cur) {
		return url.replace(/\{0\}/, cur);
	}

	connect = {
		httpApiActive: true,
		websocket: (function () {
			var currentUrl,
				connection,
				timeout,
				wait = 30000,
				maxWait = 1800000,
				errorCount = 0;
		
			function message (e){
				console.log('message function');
				console.log(e);
				setData(e);
				return;
				var data = JSON.parse(e.data);
				if (data.private === "ticker") {
					setData(data.ticker);
				} else if (data.channel) {
					connection.send(JSON.stringify({
						"op":"unsubscribe",
						"channel": data.channel
					}));
				}
			}

			function updateTicker(){
				
				var BTCUSD = NaN;
				var lastNxtPrice = NaN;
				jQuery.ajax({
						     url: "http://data.mtgox.com/api/1/BTCUSD/ticker",
						     dataType: 'json',
						     success: function(data) {
						     	console.log('showing data');
						      	BTCUSD = Number(data.return.avg.value);
						      	console.log(BTCUSD);
						      	
						      	jQuery.ajax({
								     url: "https://www.dgex.com/ticker4.cgi",
								     dataType: 'json',
								     success: function(data) {
								     	console.log('showing data');
								      	lastNxtPrice = Number(data.ticker[0].unitprice);
								      	console.log(lastNxtPrice);
								      	message( lastNxtPrice * BTCUSD);
								     }
								});

				
						     }
						});

					
				
			}
			function startConnection () {


				clearTimeout(timeout);
				updateTicker();
				setInterval(function() {
										updateTicker();
										}, 60000
							);

			}


			function init (url) {
				timeout && clearTimeout(timeout);
				wait = 30000;				

				if (url) {
					currentUrl = getUrlCurrency(url, settings.currency);
					startConnection();
				}
			}
			return init;
		}()),
		httpApi: (function (){
			var currentUrl,
			    parseDataFunc,
				timeout,
				reqDelay,
				lastFetch,
				xhr;



			function sendRequest (){
				xhr = new XMLHttpRequest();
				xhr.onreadystatechange = readyState;
			    xhr.open('GET', currentUrl);
			    xhr.send();
			}

			function timeRequest (){
				if (connect.httpApiActive) {
					sendRequest();
				} else {
					window.clearTimeout(timeout);
					timeout = setTimeout(timeRequest, reqDelay);
				}
			}
			function init (url, delay, parser){
				window.clearTimeout(timeout);
				connect.httpApiActive = false;
				if (url) {
					connect.httpApiActive = true;
					currentUrl = getUrlCurrency(url, settings.currency);
					reqDelay = window.Math.max(delay, settings.httpWait);
					parseDataFunc = parser;
					timeRequest();
				}
			}
			return init;
		}()),

		
		all: function () {
			var trackerApi = api[settings.tracker];
			if (connect.active) {
				connect.disconnect();
			}
			connect.active = true;
				connect.websocket(trackerApi.webSocketUrl);
		},
		active: false
	};




	function getSetting (key) {
		return settings[key];
	}

	function getApi (key) {
		return api[key];
	}

	connect.all();

	global = {
		currencies  : currencies,
		getSetting  : getSetting,
		getApi      : getApi,
		history     : history
	};
	return global;
}());
