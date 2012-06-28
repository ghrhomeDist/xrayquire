/**
 * @license xrayquire 0.0.0 Copyright (c) 2012, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/requirejs/xrayquire for details
 */
/*jslint nomen: true */
/*global requirejs, console, window */

/**
 * Put a script tag in the HTML that references this script right after the
 * script tag for require.js.
 */

var xrayquire;
(function () {
    'use strict';

    var contexts = {},
        config = typeof xrayquire === 'undefined' ? {} : xrayquire,
        s = requirejs.s,
        oldNewContext = s.newContext,
        tokenRegExp = /\{(\w+)\}/g,
        prop;

    function each(ary, func) {
        if (ary) {
            var i;
            for (i = 0; i < ary.length; i += 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    /**
     * Cycles over properties in an object and calls a function for each
     * property value. If the function returns a truthy value, then the
     * iteration is stopped.
     */
    function eachProp(obj, func) {
        var prop;
        for (prop in obj) {
            if (obj.hasOwnProperty(prop)) {
                if (func(obj[prop], prop)) {
                    break;
                }
            }
        }
    }

    function isRequire(id) {
        return id.indexOf('_@r') !== -1;
    }

    function formatId(id) {
        //If the ID is for a require call, make it prettier.
        return isRequire(id) ? 'require()' : id;
    }

    function formatUrl(url) {
        return !url || isRequire(url) ? '' : url;
    }

    function getX(context) {
        if (!context.xray) {
            context.xray = {
                traced: {},
                traceOrder: [],
                mixedCases: {}
            };
        }
        return context.xray;
    }

    function modContext(context) {
        var oldLoad = context.load,
            modProto = context.Module.prototype,
            oldModuleEnable = modProto.enable,
            xray = getX(context),
            traced = xray.traced,
            mixedCases = xray.mixedCases;

        function trackModule(mod) {
            var id = mod.map.id;

            //If an intermediate module from a plugin, do not
            //track it
            if (mod.map.prefix && id.indexOf('_unnormalized') !== -1) {
                return;
            }

            //Cycle through the dependencies now, wire this up here
            //instead of context.load so that we get a recording of
            //modules as they are encountered, and not as they
            //are fetched/loaded, since things could fall over between
            //now and then.
            if (!traced[id]) {
                each(mod.depMaps, function (dep) {
                    var depId = dep.id,
                        lowerId = depId.toLowerCase();

                    if (mixedCases[lowerId] && depId !== mixedCases[lowerId].id) {
                        console.error('Mixed case modules may conflict: ' +
                                        formatId(mixedCases[lowerId].refId) +
                                        ' asked for: "' +
                                        mixedCases[lowerId].id +
                                        '" and ' +
                                        formatId(id) +
                                        ' asked for: "' +
                                        depId +
                                        '"');
                    } else {
                        mixedCases[lowerId] = {
                            refId: id,
                            id: depId
                        };
                    }
                });

                traced[id] = {
                    map: mod.map,
                    deps: mod.depMaps
                };
                xray.traceOrder.push(id);
            }
        }

        modProto.enable = function () {
            var result = oldModuleEnable.apply(this, arguments);
            trackModule(this);
            return result;
        };

        //Collect any modules that are already in process
        eachProp(context.registry, function (mod) {
            if (mod.enabled) {
                trackModule(mod);
            }
        });

        return context;
    }

    //Mod any existing contexts.
    eachProp(requirejs.s.contexts, function (context) {
        modContext(context);
    });

    //Apply mods to any new context.
    s.newContext = function (name) {
        return modContext(oldNewContext);
    };

    requirejs.onResourceLoad = function (context, map, deps) {
        var id = map.id;

        if (typeof context.defined[id] === 'undefined') {
            //May be a problem with a circular dependency.
            //console.error(id + ' has undefined module value, may be part ' +
            //              'of a bad circular reference');
        }
    };


    function htmlEscape(id) {
        return (id || '')
            .replace('<', '&lt;')
            .replace('>', '&gt;')
            .replace('&', '&amp;')
            .replace('"', '&quot;');
    }

    function template(contents, data) {
        return contents.replace(tokenRegExp, function (match, token) {
            var result = data[token];

            //Just use empty string for null or undefined
            if (result === null || result === undefined) {
                result = '';
            }

            return result;
        });
    }

    /**
     * Public API
     */
    xrayquire = {
        treeHtml: '<!DOCTYPE html>\n<html>\n<head>\n<style>\nbody {\n    font-family: \"Inconsolata\",Andale Mono,Monaco,Monospace;\n    color: green;\n}\n\na {\n    color: #2E87DD;\n    text-decoration: none;\n}\n\na:hover {\n    text-decoration: underline;\n}\n\n.mod {\n    background-color: #FAFAFA;\n    border: 1px solid #E6E6E6;\n    border-radius: 5px 5px 5px 5px;\n    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.05);\n    font-size: 13px;\n    line-height: 18px;\n    margin: 7px 0 21px;\n    overflow: auto;\n    padding: 5px 10px;\n}\n\n.url {\n    font-size: smaller;\n    color: grey;\n}\n\n</style>\n</head>\n<body>\n{content}\n</body>\n</html>\n',
        treeDepItemHtml: '<li><a href=\"#mod-{htmlId}\">{id}</a></li>',
        treeItemHtml: '<div class=\"mod\" id=\"mod-{htmlId}\">\n    <span class=\"id\">{id}</span>\n    <span class=\"url\">{url}</span>\n    <ul class=\"deps\">\n        {depItems}\n    </ul>\n</div>\n',

        makeHtmlId: function (id) {
            return encodeURIComponent(id);
        },

        makeTemplateData: function (mod) {
            return {
                htmlId: xrayquire.makeHtmlId(mod.id),
                id: htmlEscape(formatId(mod.id)),
                url: htmlEscape(formatUrl(mod.url))
            };
        },

        showTree: function (context) {
            context = context || requirejs.s.contexts._;

            var xray = getX(context),
                traced = xray.traced,
                html = '';

            //Sort the traceOrder, but do it by lowercase comparisons,
            //to keep 'something' and 'Something' next to each other.
            xray.traceOrder.sort(function (a, b) {
                return a.toLowerCase() > b.toLowerCase() ? 1 : -1;
            });

            //Generate the HTML
            each(xray.traceOrder, function (id) {
                var mod = traced[id],
                    templateData = xrayquire.makeTemplateData(mod.map);

                //Do not bother if this is a require() call with no
                //dependencies
                if (isRequire(mod.map.id) && (!mod.deps || !mod.deps.length)) {
                    return;
                }

                templateData.depItems = '';

                each(mod.deps, function (dep) {
                    templateData.depItems += template(xrayquire.treeDepItemHtml,
                                             xrayquire.makeTemplateData(dep));
                });

                html += template(xrayquire.treeItemHtml, templateData);
            });

            //Put the HTML in a full HTML document.
            html = template(xrayquire.treeHtml, {
                content: html
            });

            //Convert to URL encoded data
            html = encodeURIComponent(html);

            //Display the HTML
            window.open('data:text/html;charset=utf-8,' + html, '_blank');
        }
    };
}());