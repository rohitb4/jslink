/**
 * This module contains all the helper and library functions that are required by various modules of `jslinker`.
 * @module lib
 */
var E = "",
    SPC = " ",
    PLURAL_SUFFIX = "s",
    STRING  = "string",
    FUNCTION = "function",

    fs = require("fs"),
    pathUtil = require("path"),

    lib;

module.exports = lib = /** @lends module:lib */ {

    /**
     * Adds the character `s` to the contents of the `word` parameter. This method is helpful to show messages that are
     * in tune with the value of a number.
     *
     * @param {number} num
     * @param {string} word
     * @returns {string}
     */
    plural: function (num, word) {
        return num + SPC + (num > 1 && (word += PLURAL_SUFFIX), word);
    },

    /**
     * Simple format function. Replaces construction of type “`{<number>}`” to the corresponding argument.
     *
     * @param {string} token
     * @param {...string} params
     * @returns {string}
     */
    format: function(token, params) {
        var args = Array.isArray(params) ? [0].concat(params) : arguments;
        token && (typeof token === STRING) && args.length - 1 && (token = token.replace(/\{(\d+)\}/g, function(str, i) {
            return args[++i] === null ? E : args[i];
        }));
        return token || E;
    },

    /**
     * Get string from string-like objects.
     *
     * @param {*} str
     * @returns {string}
     *
     * @throws {TypeError} If the `str` parameter passed is `null` or `undefined` or does not have a `toString` method.
     */
    stringLike: function (str) {
        // Module name has to be valid and cannot be blank.
        if (!(str && typeof str.toString === FUNCTION)) {
            throw new TypeError("Not a valid string: " + str);
        }
        // Sanitise the name for further processing - like trim it!
        return str.toString().trim();
    },

    /**
     * Copy all properties of source to sink.
     *
     * @param {object} sink
     * @param {object} source
     * @returns {object}
     */
    copy: function (sink, source) {
        for (var prop in source) {
            sink[prop] = source[prop];
        }
        return sink;
    },

    /**
     * Copies all new properties from source to sink.
     *
     * @param {object} sink
     * @param {object} source
     * @returns {object}
     */
    fill: function (sink, source) {
        for (var prop in source) {
            !sink.hasOwnProperty(prop) && (sink[prop] = source[prop]);
        }
        return sink;
    },

    /**
     * Converts an arguments array (usually from CLI) in format similar to Closure Compiler and returns an object of
     * options.
     *
     * @param {Array} args -
     * @returns {object}
     */
    argsArray2Object: function (args) {
        var out = {},
            replacer,
            arg;

        // This function is sent to the .replace function on argument values in order extract its content as key=value
        // pairs. Defined here to prevent repeated definition within loop.
        replacer = function ($glob, $1, $2) {
            // In case the value is undefined, we set it to boolean true
            ($2 === undefined) && ($2 = true);

            // If the option already exists, push to the values array otherwise create a new values array. In case
            // this option was discovered for the first time, we pust it as a single item of an array.
            out.hasOwnProperty($1) && (out[$1].push ? out[$1] : (out[$1] = [out[$1]])).push($2) || (out[$1] = $2);
        };

        // Loop through arguments and prepare options object.
        while (arg = args.shift()) {
            arg.replace(/^\-\-([a-z]*)\=?([\s\S]*)?$/i, replacer);
        }
        return out;
    },

    /**
     * Checks whether a path starts with or contains a hidden file or a folder.
     *
     * @param {string} source - The path of the file that needs to be validated.
     * @returns {boolean} `true` if the source is blacklisted and otherwise `false`.
     */
    isUnixHiddenPath: function (path) {
        return (/(^|.\/)\.+[^\/\.]/g).test(path);
    },

    /**
     * Tests whether a path is a directory or possibly a file reference.
     *
     * @param {string} path
     * @returns {boolean}
     */
    isUnixDirectory: function (path) {
        return (/(^\.{1,2}$)|(\/$)/).test(path);
    },

    /**
     * Return the JSON data stored in a file.
     *
     * @param {string} path Is always relative
     * @returns {object}
     */
    readJSONFromFile: function (path) {
        try {
            path = "./" + path;
            return JSON.parse(fs.readFileSync(path));
        }
        catch (error) {
            throw new Error(lib.format("Unable to read file: {0}\n{1}", path, error));
        }
    },

    /**
     * Iterate over an object and convert all string booleans into native boolean values.
     *
     * @param {object} obj
     * @param {Array} booleans
     * @returns {object}
     */
    parseJSONBooleans: function (obj, booleans) {
        // Check whether parameters are valid
        if ((typeof obj === "object") && Array.isArray(booleans) && booleans.length) {
            booleans.forEach(function (prop) {
                if (obj.hasOwnProperty(prop)) {
                    obj[prop] = (/\s*true\s*/ig.test(obj[prop]));
                }
            });
        }
        return obj;
    },

    /**
     * Takes in user provided path and returns a writeable path for the same.
     *
     * @param {string} path
     * @param {string} default
     * @param {boolean=} [overwrite]
     * @returns {string}
     */
    writeableFile: function (path, defaultPath , overwrite) { /** @todo refactor */
        var stat,
            dirlist,
            dir;

        // Check for hidden or invalid path
        if (!path) {
            throw new TypeError("Path cannot be blank.");
        }

        if (lib.isUnixHiddenPath(path)) {
            throw new TypeError("Cannot output to hidden file path.");
        }

        // In case path comes from cli inout and is equak to boolean true, then return default
        if (path === true) {
            path = defaultPath;
        }

        // Validate the default path
        if (lib.isUnixDirectory(defaultPath)) {
            throw new TypeError("Default path cannot be a directory.");
        }

        path = pathUtil.resolve(path.toString());

        // If the path provided exists, the only check should be that it is a file and a not a directory. If its a
        // directory, then append default file name;
        if (fs.existsSync(path)) {
            stat = fs.statSync(path);

            if (stat.isDirectory()) {
                path += pathUtil.basename(defaultPath);
            }
            else if (stat.isFile()) {
                if (overwrite === false) {
                    throw new Error(lib.format("Cannot overwrite \"{0}\"", pathUtil.basename(path)));
                }
            }
            else {
                throw new TypeError("The output path does not point to a file.");
            }
        }
        // If file does not exist then we climb up the directory tree and recover the tree of folders that needs to be
        // created.
        else {

            dirlist = [];
            if (lib.isUnixDirectory(path)) {
                dir = path;
                path += pathUtil.basename(defaultPath); // add file name if path is a directory
            }
            else {
                dir = pathUtil.dirname(path);
            }

            // Extract directories within the path that does not exist.
            while (!fs.existsSync(dir) && (dir !== "/")) {
                dirlist.push(dir);
                dir = pathUtil.dirname(dir);
            }
            // We now slowly create the directories recovered from the above loop.
            while (dir = dirlist.pop()) {
                fs.mkdirSync(dir); // let any error bubble.
            }
        }

        return path;
    },

    /**
     * Takes in user provided path and returns a writeable path for the same.
     *
     * @param {string} path
     * @param {string} default
     * @param {boolean=} [overwrite]
     * @returns {string}
     */
    writeableFolder: function (path, defaultPath , overwrite) { /** @todo refactor */
        var stat,
            dirlist,
            dir;

        // Check for hidden or invalid path
        // // In case path comes from cli inout and is equak to boolean true, then return default
        if (!path || path === true) {
            path = defaultPath;
        }

        if (lib.isUnixHiddenPath(path)) {
            throw new TypeError(lib.format("The path \"{0}\" points to a hidden file.", path));
        }

        // Validate the default path and the required path to at least theoretically point to directories.
        if (!lib.isUnixDirectory(defaultPath)) {
            throw new TypeError(lib.format("Path \"{0}\" cannot point to a file.", defaultPath));
        }
        if (!lib.isUnixDirectory(path)) {
            throw new TypeError(lib.format("Path \"{0}\" cannot point to a file.", path));
        }

        path = pathUtil.resolve(path.toString());

        // In case output exusts, we check whether it is a folder
        if (fs.existsSync(path)) {
            stat = fs.statSync(path);

            if (!stat.isDirectory()) {
                throw new TypeError(lib.format("The output path \"{0}\" does not point to a directory."), path);
            }
            else if (overwrite === false) {
                throw new Error(lib.format("Cannot overwrite \"{0}\"", pathUtil.basename(path)));
            }
        }
        // If file does not exist then we climb up the directory tree and recover the tree of folders that needs to be
        // created.
        else {
            dirlist = [];
            dir = path;

            // Extract directories within the path that does not exist.
            while (!fs.existsSync(dir) && (dir !== "/")) {
                dirlist.push(dir);
                dir = pathUtil.dirname(dir);
            }
            // We now slowly create the directories recovered from the above loop.
            while (dir = dirlist.pop()) {
                fs.mkdirSync(dir); // let any error bubble.
            }
        }

        return path;
    }
};