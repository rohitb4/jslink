/**
 * This module defines the `Module` and the collection of modules as `ModuleCollection`. The classes allows easy
 * dependency calculation of modules.
 * @module collection
 *
 * @requires lib
 */
var lib = require("./lib.js"),
    ModuleCollection,
    collectionTopoSort,
    collectionAdjacencyIndex;

/**
 * This function recursively traverses through modules (vertices of a DAG) and pushes them to a stack in a neatly sorted
 * order based on its dependency trace.
 *
 * @private
 * @param {module:collection~ModuleCollection.Module} module
 * @param {Array<module:collection~ModuleCollection.Module>} sortStack
 */
collectionTopoSort = function (module, sortStack) {
    var item;

    if (module.topologicalMarker) {
        delete module.topologicalMarker;
        throw "Cyclic dependency error discovered while parsing: " + module.name;
    }

    if (!module.sorting) {
        module.topologicalMarker = true;
        for (item in module.requires) {
            collectionTopoSort(module.requires[item], sortStack); // recurse
        }
        delete module.topologicalMarker;
        module.sorting = true;
        // Push into the right index
        (sortStack[module.index] || (sortStack[module.index] = [])).push(module);
    }
};

/**
 * This function recursively traverses through the modules and assigns them an index based on the level of bidirectional
 * connectivity.
 *
 * @private
 * @param {module:collection~ModuleCollection.Module} module
 * @param {number} index
 */
collectionAdjacencyIndex = function (module, index) {
    var item;

    if (!module.indexing) {
        module.index = index;
        module.indexing = true;

        for (item in module.requires) {
            collectionAdjacencyIndex(module.requires[item], index);
        }
        for (item in module.dependants) {
            collectionAdjacencyIndex(module.dependants[item], index);
        }
    }
};

/**
 * Represents a collection of modules that have ability to depend on each other. The class maintains the dependency
 * link between modules and also the file source list that defines these modules. An equivalent representation of this
 * collection is Directed Acyclic Graph.
 * @class
 */
ModuleCollection = function () {
    /**
     * Stores all modules. In the context of digraph, this is the set of all vertices.
     * @type {Object<module:collection~ModuleCollection.Module>}
     */
    this.modules = {};

    /**
     * Keeps a track of the number of modules that exists in this collection.
     * @type {number}
     */
    this.numberOfModules = 0;

    /**
     * Stores the path of all source files with all modules defined within that source. Since one source can define more
     * than module, they are stored as array of modules per source. Usually, one does not need to access this directly
     * since the method {@link module:collection~ModuleCollection#getBySource} acts as getter.
     * @type {Object<Array>}
     */
    this.sources = {};

    /**
     * Stores all connections. In the context of digraph, this is the set of all directed edges.
     * @type {Array<module:collection~ModuleCollection.Dependency>}
     */
    this.dependencies = [];

    /**
     * Keeps a track of the number of dependencies added to this collection.
     * @type {number}
     */
    this.numberOfDependencies = 0;
};

lib.copy(ModuleCollection.prototype, /** @lends module:collection~ModuleCollection.prototype */ {
    /**
     * Get a new module from collection and if it does not exist, create one.
     *
     * @param {string} name -
     * @param {boolean=} [anyway] -
     * @returns {module:collection~ModuleCollection.Module}
     */
    get: function (name, anyway) {
        return this.modules[(name = lib.stringLike(name))] || anyway &&
            (++this.numberOfModules, this.modules[name] = new ModuleCollection.Module(name));
    },

    /**
     * Gets a node by it's source file name.
     *
     * @param {string} source
     * @returns {Object<module:collection~ModuleCollection.Module>}
     */
    getBySource: function (source) {
        return this.sources[source];
    },

    /**
     * Add a new module to the collection
     *
     * @param {string} name
     * @param {string} source
     * @returns {module:collection~ModuleCollection.Module}
     */
    add: function (name, source) {
        return ((this.sources[(this._recentModule = this.get(name, true).define(source)).source] ||
            (this.sources[this._recentModule] = {}))[this._recentModule.source] = this._recentModule);
    },

    /**
     * Marks one module as dependency of the other.
     *
     * @param {string} module -
     * @param {string} dependency -
     * @returns {module:collection~ModuleCollection.Dependency}
     */
    connect: function (module, dependency) {
        return (this.dependencies.push((this._recentDependency = new ModuleCollection.Dependency(this.get(module, true),
            this.get(dependency, true)))), ++this.numberOfDependencies, this._recentDependency);
    },

    /**
     * Analyse the collection and return statistics. This is performance intensive for very large collection, hence it
     * is suggested to be cached during re-use.
     * @returns {object}
     */
    analyse: function () {
        var stat = {},
            i,
            ii;
        // Execute all the analysers over this stats object.
        for (i = 0, ii = ModuleCollection.analysers.length; i < ii; i++) {
            ModuleCollection.analysers[i].call(this, stat);
        }
        return stat;
    },

    /**
     * Clones the collection.
     * @returns {module:collection~ModuleCollection}
     */
    clone: function () {
        var clone = new ModuleCollection(),
            item,
            i,
            ii;

        // Clone the sources
        for (item in this.modules) {
            clone.add(this.modules[item].clone(), this.modules[item].source);
        }

        // filter out and add the vertices that are defined at both ends.
        for (i = 0, ii = this.dependencies.length; i < ii; i++) {
            item = this.dependencies[i];
            clone.connect(item.module, item.require);
        }

        return clone;
    },

    /**
     * Serialises the modules using topological sorting mechanism and returns an array of arrays containing all modules
     * in the sorted order.
     * @returns {Array<Array>}
     */
    serialize: function () {
        var sortStack = [], // array to hold all the sorted modules.
            adjacencyPoint = 0,
            modules = this.modules,
            module;

        // Iterate over all modules, index them and run topological sort. Indexing will always go faster than sorting
        // since index happens on both ingress and egress edges at the same time, as such 2x the cycle of sorting.
        for (module in modules) {
            module = modules[module];
            if (!module.indexing) {
                collectionAdjacencyIndex(module, adjacencyPoint++);
            }
            if (!module.sorting) {
                collectionTopoSort(module, sortStack);
            }
        }

        // Iterate over modules once more to remove all sorting flags. This is unneeded if the intention is to sort
        // once only.
        for (module in modules) {
            delete modules[module].sorting;
            delete modules[module].indexing;
        }

        return sortStack;
    },


    toString: function () {
        var out = "digraph jslink {\n",
            module,
            dependant;

        // Iterate through all modules and map them along with their dependencies.
        for (module in this.modules) {
            module = this.modules[module];
            // In case there are no requirements, output the module as an isolated one.
            if (module.numberOfDependants) {
                for (dependant in module.dependants) {
                    out += lib.format("\"{0}\"->\"{1}\";\n", module, dependant);
                }
            }
            else {
                out += "\"" + module.name + "\";\n";
            }

        }
        return (out += "}");
    }
});

/**
 * This class represents the dependency relationship between two modules
 * ({@link module:collection~ModuleCollection.Module}.) The only two restrictions being that a module cannot be marked
 * to depend on itself (to prevent loops in the dependency tree,) and that same dependency cannot be duplicated.
 *
 * @class
 * @param {module:collection~ModuleCollection.Module} module
 * @param {module:collection~ModuleCollection.Module} requirement
 *
 * @example
 * // We will create two modules and then mark a relationship between them. The two modules are `product` and `customer`
 * // with the definition of `product` is annotated with "@requires customer".
 * var prod = new ModuleCollection.Module("product"),
 *     cust = new ModuleCollection.Module("customer"),
 *     needs;
 *
 * // mark that `product` module requires `customer`
 * needs = new ModuleCollection.Dependency(prod, cust);
 *
 * // Check whether the dependency was marked successfully.
 * console.log(needs); // outputs "product" -> "customer"
 * console.log(!!prod.requires["customer"]) // outputs "true"
 */
ModuleCollection.Dependency = function (module, requirement) {
    // Connect the modules internally. Most validations will happen there itself.
    module.require(requirement);

    /**
     * This property specifies the end-point of the dependency. In other words, it specifies the module that
     * {@link module:collection~ModuleCollection.Dependency#module} requires.
     * @type {module:collection~ModuleCollection.Dependency}
     * @readOnly
     */
    this.require = requirement;

    /**
     * This property specifies the module that declares its requirement.
     * @type {module:collection~ModuleCollection.Dependency}
     * @readOnly
     */
    this.module = module;
};

lib.copy(ModuleCollection.Dependency.prototype, /** @lends module:collection~ModuleCollection.Dependency.prototype */ {
    toString: function () {
        return lib.format("\"{0}\"->\"{1}\";", this.module.toString().replace(/\"/g, "\\\""),
            this.require.toString().replace(/\"/g, "\\\""));
    }
});

/**
 * This class represents one module whether defined by a source file or specified as a requirement of a module being
 * defined. Module objects by default do not maintain dependencies, but stores them as references.
 *
 * @class
 * @param {string} name
 * @param {string=} [source]
 *
 * @example
 * // Create a new module and also mark that the module is defined by providing the file path of this module.
 * var module = new ModuleCollection.Module("main.process", "develop/main.js");
 *
 * // Create a new module, but keep it undefined without providing the source file path.
 * var module = new ModuleCollection.Module("main.output");
 */
ModuleCollection.Module = function (name, source) {
    /**
     * The name or identifier string of the module. In all contexts this is the value that is to be used to refer to the
     * module in case a direct reference to the instance variable is not possible.
     * @type {string}
     * @readOnly
     */
    this.name = lib.stringLike(name);

    // Validate the name to not be blank.
    if (!this.name) {
        throw new TypeError("Module name cannot be blank.");
    }
    /**
     * Stores all modules that this module needs/requires. (Verices that head this.)
     * @type {Object<module:collection~ModuleCollection.Dependency>}
     */
    this.requires = {};
    /**
     * Number of modules that this module depends on. ("Egress Valency" in context of directed graph.)
     * @type {number}
     */
    this.numberOfRequirements = 0;
    /**
     * Stores all modules that require this module. (Verices that tail this.)
     * @type {Object<module:collection~ModuleCollection.Dependency>}
     */
    this.dependants = {};
    /**
     * Number of modules that says that it depends on this module. ("Inress Valency" in context of directed graph.)
     * @type {number}
     */
    this.numberOfDependants = 0;

    /**
     * Export directives
     * @property {Object<Array>} [targets]
     */
    this.exports = [];

    /**
     * The source file path that defines this module. This is to be used as a getter and should be set using the
     * {@link module:collection~ModuleCollection.Module#define} method.
     * @type {string}
     * @readOnly
     */
    this.source = undefined;

    // Define the node if passed as part of constructor.
    source && this.define(source);
};

lib.copy(ModuleCollection.Module.prototype, /** @lends module:collection~ModuleCollection.Module.prototype */ {
    /**
     * Modules can be created and yet be not marked as defined. Definition takes place only when a value is passed to
     * it - usually the source path.
     *
     * @chainable
     * @returns {module:collection~ModuleCollection.Module}
     */
    define: function (source) {
        // Redefinition is not allowed.
        if (this.defined()) {
            throw lib.format("Duplicate definition of {0} at: {1}\n\nAlready defined by {2}", this.name, source,
                this.source);
        }
        this.source = lib.stringLike(source); // store
        return this; // chain
    },

    /**
     * Add the list of target modules marked for export.
     * @param {module:collection~ModuleCollection.Module} module
     * @param {string} meta
     */
    addExport: function (meta) {
        // If export meta is not defined then we treat the module name as meta.
        if (!meta) {
            meta = this.name;
        }
        // We add the meta information unless there is a duplicate. At least the same module should not have two same
        // export meta!
        if ((this.exports || (this.exports = [])).indexOf(meta) === -1) {
            this.exports.push(meta);
        }

        return module;
    },

    /**
     * Check whether the module has been defined formally. Modules can be created and yet be not marked as defined.
     *
     * @returns {boolean}
     */
    defined: function () {
        return this.source !== undefined;
    },

    /**
     * Marks that this module requires another module (as passed via parameter.)
     *
     * @param {module:collection~ModuleCollection.Module} requirement
     * @chainable
     * @returns {module:collection~ModuleCollection.Module}
     */
    require: function (requirement) {
        // Module cannot depend on itself and it cannot add a dependency already added.
        if (this.name === requirement.name) {
            throw lib.format("Module {0} cannot depend on itself!", this);
        }

        if (this.requires[requirement] || requirement.dependants[this]) {
            throw lib.format("{1} already marked as requirement of {0}", this.name, requirement.name);
        }

        // Store the dependency within both the connected modules.
        this.requires[requirement] = requirement;
        this.numberOfRequirements++;
        requirement.dependants[this] = this;
        requirement.numberOfDependants++;

        return this;
    },

    /**
     * Clone this module.
     * @returns {module:collection~ModuleCollection.Module}
     */
    clone: function () {
        return new ModuleCollection.Module(this.name, this.source);
    },

    toString: function () {
        return this.name;
    }
});


ModuleCollection.analysers = [];

// Functions to analyse the collection.
ModuleCollection.analysers.push(function (stat) {
    var module,
        prop;

    stat.orphanModules = [];
    stat.definedModules = [];
    stat.numberOfExports = 0;

    for (prop in this.modules) {
        module = this.modules[prop];
        stat[module.defined() ? "definedModules" : "orphanModules"].push(module);
        stat.numberOfExports += module.exports.length || 0;
    }
});

module.exports = ModuleCollection;