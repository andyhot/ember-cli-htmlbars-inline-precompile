/* jshint node: true */
'use strict';

const path = require('path');
const hashForDep = require('hash-for-dep');
// const HTMLBarsInlinePrecompilePlugin = require('babel-plugin-htmlbars-inline-precompile');
const AstPlugins = require('./lib/ast-plugins');
const VersionChecker = require('ember-cli-version-checker');
const SilentError = require('silent-error');
const debugGenerator = require('heimdalljs-logger');

const _logger = debugGenerator('ember-cli-htmlbars-inline-precompile');

module.exports = {
  name: 'ember-cli-htmlbars-inline-precompile',

  init() {
    this._super.init && this._super.init.apply(this, arguments);

    let checker = new VersionChecker(this);
    let hasIncorrectBabelVersion = checker.for('ember-cli-babel', 'npm').lt('6.0.0-alpha.1');

    if (hasIncorrectBabelVersion) {
      throw new SilentError(`ember-cli-htmlbars-inline-precompile@0.4 requires the host to use ember-cli-babel@6. To use ember-cli-babel@5 please downgrade ember-cli-htmlbars-inline-precompile to 0.3.`);
    }
  },

  setupPreprocessorRegistry(type, registry) {
    if (type === 'parent') {
      this.parentRegistry = registry;
    }
  },

  included() {
    this._super.included.apply(this, arguments);

    let emberCLIHtmlBars = this.project.findAddonByName('ember-cli-htmlbars');

    if(emberCLIHtmlBars && emberCLIHtmlBars.inlinePrecompilerRegistered) {
      return;
    }

    let checker = new VersionChecker(this);

    let emberCLIUsesSharedBabelPlugins = checker.for('ember-cli', 'npm').lt('2.13.0-alpha.1');
    let addonOptions = this._getAddonOptions();
    let isProjectDependency = this.parent === this.project;
    let babelPlugins;

    if (emberCLIUsesSharedBabelPlugins && isProjectDependency) {
      addonOptions.babel6 = addonOptions.babel6 || {};
      babelPlugins = addonOptions.babel6.plugins = addonOptions.babel6.plugins || [];
    } else {
      addonOptions.babel = addonOptions.babel || {};
      babelPlugins = addonOptions.babel.plugins = addonOptions.babel.plugins || [];
    }

    let pluginWrappers = this.parentRegistry.load('htmlbars-ast-plugin');

    // add the HTMLBarsInlinePrecompilePlugin to the list of plugins used by
    // the `ember-cli-babel` addon
    if (!this._registeredWithBabel) {
      let templateCompilerPath = this.templateCompilerPath();
      let parallelConfig = this.getParallelConfig(pluginWrappers);
      if (this.canParallelize(pluginWrappers)) {
        _logger.debug('using parallel API with broccoli-babel-transpiler');
        babelPlugins.push({
          _parallelBabel: {
            requireFile: path.resolve(__dirname, 'lib/require-from-worker'),
            buildUsing: 'build',
            params: {
              templateCompilerPath,
              parallelConfig
            }
          }
        });
      }
      else {
        _logger.debug('NOT using parallel API with broccoli-babel-transpiler');
        let blockingPlugins = pluginWrappers.map((wrapper) => {
          if (wrapper.parallelBabel === undefined) {
            return wrapper.name;
          }
        }).filter(Boolean);
        _logger.debug('Prevented by these plugins: ' + blockingPlugins);

        let pluginInfo = this.astPlugins();
        let htmlBarsPlugin = AstPlugins.setup(pluginInfo, {
          projectConfig: this.projectConfig(),
          templateCompilerPath: this.templateCompilerPath(),
        });
        babelPlugins.push(htmlBarsPlugin);
      }
      this._registeredWithBabel = true;
    }
  },

  _getAddonOptions() {
    return (this.parent && this.parent.options) || (this.app && this.app.options) || {};
  },

  // from ember-cli-htmlbars :(
  astPlugins() {
    let pluginWrappers = this.parentRegistry.load('htmlbars-ast-plugin');
    let plugins = [];
    let cacheKeys = [];

    for (let i = 0; i < pluginWrappers.length; i++) {
      let wrapper = pluginWrappers[i];

      plugins.push(wrapper.plugin);

      if (typeof wrapper.baseDir === 'function') {
        let pluginHashForDep = hashForDep(wrapper.baseDir());
        cacheKeys.push(pluginHashForDep);
      } else {
        // support for ember-cli < 2.2.0
        let log = this.ui.writeDeprecateLine || this.ui.writeLine;

        log.call(this.ui, 'ember-cli-htmlbars-inline-precompile is opting out of caching due to an AST plugin that does not provide a caching strategy: `' + wrapper.name + '`.');
        cacheKeys.push((new Date()).getTime() + '|' + Math.random());
      }
    }

    return {
      plugins: plugins,
      cacheKeys: cacheKeys
    };
  },

  // verify that each registered ast plugin can be parallelized
  canParallelize(pluginWrappers) {
    return pluginWrappers.every((wrapper) => wrapper.parallelBabel !== undefined);
  },

  // return an array of the 'parallelBabel' object for each registered htmlbars-ast-plugin
  getParallelConfig(pluginWrappers) {
    return pluginWrappers.map((wrapper) => wrapper.parallelBabel);
  },

  // borrowed from ember-cli-htmlbars http://git.io/vJDrW
  projectConfig() {
    return this.project.config(process.env.EMBER_ENV);
  },

  // borrowed from ember-cli-htmlbars http://git.io/vJDrw
  templateCompilerPath() {
    let config = this.projectConfig();
    let templateCompilerPath = config['ember-cli-htmlbars'] && config['ember-cli-htmlbars'].templateCompilerPath;

    let ember = this.project.findAddonByName('ember-source');
    if (ember) {
      return ember.absolutePaths.templateCompiler;
    } else if (!templateCompilerPath) {
      templateCompilerPath = this.project.bowerDirectory + '/ember/ember-template-compiler';
    }

    return path.resolve(this.project.root, templateCompilerPath);
  }
};
