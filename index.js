var Stremio = require("stremio-addons");
var nameToImdb = require("name-to-imdb");
var needle = require("needle");
var feedparser = require("feedparser");
// 1. torrentz.eu, kickasstorrents.to, bitsnoop, zamunda, http://www.1337x.to/	
var manifest = { 
    "name": "Kick.asS",
    "description": "kickass torrents add-on for stremio",
    "icon": "URL to 256x256 monochrome png icon", 
    "background": "URL to 1366x756 png background",
    "id": "org.katfan.kat",
    "version": "1.0.0",
    "types": ["movie", "series"],
    "filter": { "query.imdb_id": { "$exists": true }, "query.type": { "$in":["series","movie"] } }
};


var client = new Stremio.Client();
client.add("http://cinemeta.strem.io/stremioget");


var methods = { };
var addon = new Stremio.Server(methods, { stremioget: true }, manifest);

var server = require("http").createServer(function (req, res) {
    addon.middleware(req, res, function() { res.end() }); // wire the middleware - also compatible with connect / express
}).on("listening", function()
{
    console.log("Kick.asS Stremio Addon listening on "+server.address().port);
}).listen(process.env.PORT || 7321);

// Streaming
methods["stream.find"] = function(args, callback) {
    if (! args.query) return callback();
    if (! args.query.imdb_id) return callback();
    
    var m;
    (function(next) {
        m = nameToImdb.byImdb[args.query.imdb_id];
        if (m) return next();
        else client.meta.get({ projection: "lean", query: { imdb_id: args.query.imdb_id } }, function(err, res) {
            m = res;
            next();
        });
    })(function() {
        if (! m) return callback(new Error("unable to resolve meta"));
        
        if (args.query.type === "series") {
            doQueries([
               // m.name+" season "+args.query.season, // no logic implemented to choose the proper vid file
                m.name+" s"+pad(args.query.season)+"e"+pad(args.query.episode) 
            ], args, callback); 
        } else { 
            doQueries([ m.name+" "+m.year ], args, callback); 
        }
    });
};

/*
// Add sorts to manifest, which will add our own tab in sorts
manifest.sorts = [{prop: "popularities.helloWorld", name: "Hello World",types:["movie"]}];

// Prefer this add-on for queries with sort.popularities.helloWorld property (used when using the sort order)
manifest.filter["sort.popularities.helloWorld"] = { $exists: true };
*/


/* utils
 */
var OPTS = {
    headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/45.0.2454.99 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8", 
    },
    follow_max: 3
};

function doQueries(queries, args, callback) {
    var URL = "https://kickasstorrents.to/usearch/"+encodeURIComponent(queries[0])+"/?rss=1";

    // todo async.each on all queries
    var stream = needle.get(URL, OPTS).pipe(new feedparser());
    var results = [];
    var hasError;

    stream.on("data", function(d) { results.push(mapFromFeed(d)) });
    stream.on("error", function(e) {
        console.error(e);
        callback(e);
        hasError = true;
    });
    stream.on("finish", function() {
        if (hasError) return;

        var cat = args.query.type === "series" ? "TV" : "Movies";
        var toTry = results.filter(function(x) { return x.categories.indexOf(cat) > -1 }).slice(0,2); // maybe increase?

        function tryNext() {
            var tried = toTry.shift();
            if (! tried) return callback(null, new Error('not found'));

            needle.get(tried.link, OPTS, function(err, resp, body) { 
                if (err) console.error(err);

                var match = body && body.match(new RegExp("\/title\/(tt[0-9]+)\/")); // Match IMDB Id from the whole body
                var id = match && match[1];

                if (id && args.query.imdb_id === id) return callback(null, [{
                    infoHash: tried.infohash,
                    availability: 2, // TODO: from seeders
                    //mapIdx: TODO find the file index for full-season torrents 
                }]);
                else tryNext();
            })
        }
        tryNext();
    });
}

function pad(n) {
    return ("00"+n).slice(-2)
}

function mapFromFeed(p) {
    // leverage more data?
    return {
        title: p.title,
        link: p.link,
        categories: p.categories,
        author: p['rss:author'] && p['rss:author']['#'],
        infohash: p['torrent:infohash'] && p['torrent:infohash']['#'].toLowerCase(),
        magnet: p['torrent:magneturi'] && p['torrent:magneturi']['#'],
        filename: p['torrent:filename'] && p['torrent:filename']['#']
    }
}
