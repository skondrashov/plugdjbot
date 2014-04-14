/**
 * PlugDJBot namespace.
 */
if ("undefined" == typeof(PlugDJBot)) {
	var PlugDJBot = {};
	PlugDJBot.initialized = false;

	PlugDJBot.init = function()
	{
		// creates a handle to access all plugin preferences
		var prefs = Components.classes["@mozilla.org/preferences-service;1"]
			.getService(Components.interfaces.nsIPrefService)
			.getBranch("extensions.plugdjbot.");
		if (!PlugDJBot.initialized)
		{
			PlugDJBot.initialized = true;

			// checks to make sure we're on the right website and in in the right plug.dj room
			var currBrowser = 
				Components
				.classes["@mozilla.org/appshell/window-mediator;1"]
				.getService(Components.interfaces.nsIWindowMediator)
				.getMostRecentWindow("navigator:browser")
				.getBrowser();
			if (currBrowser.currentURI.spec != "http://plug.dj/kuralesache/")
				return;

			// updates preferences based on options window
			prefs.QueryInterface(Components.interfaces.nsIPrefBranch);
			prefs.addObserver("", this, false);
			this.observe = function(subject, topic, data)
			{
				if (topic != "nsPref:changed")
					return;
				switch(data)
				{
					case "":
						break;
				}
			};

			// reads the blacklist array from the cookie and creates a function to add cids to the blacklist
			var uri = Components.classes["@mozilla.org/network/io-service;1"].getService(Components.interfaces.nsIIOService).newURI("http://plugdj.bot", null, null);
			var cookieSvc = Components.classes["@mozilla.org/cookieService;1"].getService(Components.interfaces.nsICookieService);
			cookieSvc.setCookieString(uri, null, '["2HQaBWziYvY"];expires=Wed, 18 May 2033 00:00:00 GMT;', null);
			var blacklist = eval(cookieSvc.getCookieString(uri,null));
			function blacklistAppend(cid)
			{
				cookieSvc.setCookieString(uri, null, cookieSvc.getCookieString(uri, null).slice(0,-1) + ',"' + cid + '"];expires=Wed, 18 May 2033 00:00:00 GMT;', null);
				blacklist = eval(cookieSvc.getCookieString(uri,null));
			}
						
			// binds the plug.dj API object to a more manageable local variable
			var API = currBrowser.contentDocument.defaultView.wrappedJSObject.API
				.bind(currBrowser.contentDocument.defaultView.wrappedJSObject.API);

			// a function to kick users (including yourself)
			function removeDJ()
			{
				var id = API.getDJ().id;
				if (API.getUser().id == id)
					API.djLeave();
				else
					API.moderateRemoveDJ(id);
			}

			// Forces the bot to check if a newly loaded song is a
			// repeat of a track that has already been played. It looks back
			// through a number of songs defined by prefs.noRepeatNumber every time
			// a new track is played. If prefs.noRepeatNumber is 0, then this block
			// is disabled (to avoid uselessly checking the last 0 songs).
			this.initNoRepeat = function()
			{
				// An array is created and filled to store the cid's of the history
				var history = [];
				for (var i = 0; i < prefs.getIntPref("noRepeatNumber"); ++i)
				{
					var track = API.getHistory()[i];
					if (track)
						history[i] = track.media.cid;
					else
						history[i] = "";
				}

				// The new song is checked against the stored history, and a skip
				// is forced if a match is found.
				function enforceNoRepeat(obj)
				{
					if (!obj.media)
						return;
					var cid = obj.media.cid;
					for (var i = 0; i < prefs.getIntPref("noRepeatNumber"); ++i)
					{
						if (cid == history[i])
						{
							removeDJ();
							API.sendChat("<" + obj.media.author + " - " + obj.media.title +"> Skipped: This song was already played " + (i+1) + " song(s) ago.");
							return;
						}
					}
					history.pop();
					history.unshift(cid);
				}

				// norepeat is enforced on every new DJ appearance
				API.on(API.DJ_ADVANCE, enforceNoRepeat);
			};

			// Forces the bot to check if a newly loaded song is longer than a
			// certain duration, defined by prefs.maxDuration. If
			// prefs.maxDuration is 0, then this block is disabled.
			this.initEnforceDuration = function()
			{
				function enforceMaxDuration(obj)
				{
					if (!obj.media)
						return;
					if (obj.media.duration > prefs.getIntPref("maxDuration"))
					{
						removeDJ();
						API.sendChat("<" + obj.media.author + " - " + obj.media.title +"> Skipped: The song was too long. New DJs can only play songs shorter than " + new Date(prefs.getIntPref("maxDuration")*1000).toTimeString().substr(3,5) + ".");
					}
				}

				API.on(API.DJ_ADVANCE, enforceMaxDuration);
			};

			// Forces the bot to start DJing if the last DJ stops DJing,
			// so that the music never stops.
			this.initVoidFiller = function()
			{
				var lastDJ = API.getUser().id;
				function fillVoid(obj)
				{
					if (!obj.media && API.getUser().id != lastDJ)
						API.djJoin();
					if (API.getDJ())
						lastDJ = API.getDJ().id;
				}

				API.on(API.DJ_ADVANCE, fillVoid);
			};

			// Forces the bot to remove any chat messages with "http://", "https://", or "www." as substrings
			this.initEraseChatLinks = function()
			{
				function enforceChatLinkDelete(msg)
				{
					if (msg.type != "message")
						return;
					m = msg.message.toLowerCase();
					if (m.indexOf("http://")+1 || m.indexOf("https://")+1 || m.indexOf("www.")+1)
					{
						API.moderateDeleteChat(msg.chatID);
						API.sendChat("Message Deleted: Posting links is not allowed.");
					}
				}

				API.on(API.CHAT, enforceChatLinkDelete);
			};
			
			// Forces the bot to skip songs found on the blacklist
			this.initEnforceBlacklist = function()
			{
				function enforceBlacklist(obj)
				{
					if (!obj.media)
						return;
					for (var i=0;i<blacklist.length;++i)
						if (obj.media.cid == blacklist[i])
						{
							removeDJ();
							API.sendChat("<" + obj.media.author + " - " + obj.media.title +"> Skipped: This song is banned in this room.");
						}
				}
				
				API.on(API.DJ_ADVANCE, enforceBlacklist);
			};

			this.banSong = function()
			{
				var song = API.getMedia();
				blacklistAppend(song.cid);
				removeDJ();
				API.sendChat('<' + song.author + ' - ' + song.title +'> Skipped: This song was added to the blacklist by ' + API.getUser().username + '.');
			};
				
			this.stop = function()
			{
				gBrowser.contentWindow.wrappedJSObject.API.off();
			};
		}
		// initializes each module based on preferences
		if (prefs.getIntPref("noRepeatNumber"))
			this.initNoRepeat();

		if (prefs.getIntPref("maxDuration"))
			this.initEnforceDuration();

		if (prefs.getBoolPref("useVoidFiller"))
			this.initVoidFiller();

		if (prefs.getBoolPref("eraseChatLinks"))
			this.initEraseChatLinks();
			
		if (prefs.getBoolPref("enforceBlacklist"))
			this.initEnforceBlacklist();
	};
	
	PlugDJBot.openPreferences = function()
	{
		if (null == this._preferencesWindow || this._preferencesWindow.closed)
			this._preferencesWindow = window.openDialog("chrome://plugdjbot/content/options.xul", "plugdjbot-prefs", "chrome,titlebar,toolbar,centerscreen" + (Application.prefs.get("browser.preferences.instantApply").value ? ",dialog=no" : ",modal"));
		this._preferencesWindow.focus();
	};
};