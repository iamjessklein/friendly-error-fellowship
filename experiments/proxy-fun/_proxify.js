define('proxify', [
  'p5',
  './check-arguments',
  './docs'
], function(p5, checkArguments, docs) {
  var P5_CLASS_RE = /^p5\.([^.]+)$/;
  var prototypeProxies = new Map();
  var proxyPrototypes = new Map();

  function createProxyForClassMethod(classitem, fn) {
    var showHelp = function() {
      var url = 'http://p5js.org/reference/#/' + classitem.class +
                '/' + classitem.name;

      console.log(
        classitem.name + "()\n\n" + classitem.description + "\n\n" +
        "For more information, see: " + url
      );
    };

    var handler = {
      apply: function(target, thisArg, argumentsList) {
        checkArguments(target, thisArg, argumentsList, classitem);
        return target.apply(thisArg, argumentsList);
      },
      get: function(target, property) {
        if (property == 'bind')
          return function() {
            return buildProxy(target.bind.apply(target, arguments));
          };
        return target[property];
      }
    };

    var buildProxy = function(fn) {
      if (!fn.hasOwnProperty('help')) {
        Object.defineProperty(fn, 'help', {
          configurable: true,
          enumerable: true,
          get: showHelp
        });
      }
      return new Proxy(fn, handler);
    };

    return buildProxy(fn);
  }

  function createProxyForClassPrototype(className, classObj) {
    var proto = classObj.prototype;
    var proxy;
    var classitemMap = {};
    var methodMap = {};

    if (prototypeProxies.has(proto))
      throw new Error('proxy already exists for ' + className);

    docs.classitems.forEach(function(classitem) {
      // Note that we check for classitem.name because some methods
      // don't appear to define them... Filed this as
      // https://github.com/processing/p5.js/issues/1252.
      if (classitem.class === className && classitem.name) {
        if (classitemMap.hasOwnProperty(classitem.name)) {
          console.log("Duplicate definition for " + className + "." +
                      classitem.name, classitem);
        }
        classitemMap[classitem.name] = classitem;
      }
    });

    proxy = new Proxy(proto, {
      getPrototypeOf: function(target) {
        // It's possible that we're a subclass of another class that's
        // proxied. If that's the case, we want to return the *proxied*
        // prototype rather than the original one, so that the instanceof
        // operator still works.

        var proto = Object.getPrototypeOf(target);
        if (prototypeProxies.has(proto)) {
          return prototypeProxies.get(proto);
        }
        return proto;
      },
      get: function(target, name) {
        // TODO: Consider adding a 'did you mean?' message if name is
        // not in target, as per Ruby 2.3. This actually might be impossible
        // given that it seems there's no way to differentiate between a
        // `'foo' in bar` versus `bar.foo()`, though, which is unfortunate,
        // as any solution would break duck-typing.
        //
        // Note that Gecko did once support a __noSuchMethod__, which
        // would have been perfect for this, but it's been removed since
        // the addition of JS proxies. Some details on how to closely
        // approximate it with proxies can be found in this discussion:
        //
        // https://bugzilla.mozilla.org/show_bug.cgi?id=683218

        if (name[0] === '_') return target[name];
        if (typeof(target[name]) === 'function' &&
            classitemMap.hasOwnProperty(name)) {
          if (!methodMap.hasOwnProperty(name)) {
            methodMap[name] = createProxyForClassMethod(
              classitemMap[name],
              target[name]
            );
          }
          return methodMap[name];
        }
        return target[name];
      }
    });

    prototypeProxies.set(proto, proxy);
    proxyPrototypes.set(proxy, proto);

    return proxy;
  }

  return function proxify() {
    Object.keys(docs.classes).forEach(function(key) {
      if (key === 'p5') {
        p5.prototype = createProxyForClassPrototype('p5', p5);
      } else if (P5_CLASS_RE.test(key)) {
        var prop = key.match(P5_CLASS_RE)[1];

        if (typeof(p5[prop]) === 'function') {
          p5[prop].prototype = createProxyForClassPrototype(key, p5[prop]);
        } else {
          // It's almost certainly a documented class for an addon that
          // isn't currently loaded.
        }
      } else {
        console.log("Unrecognized class: " + key);
      }
    });

    // Some classes, like the existing p5.Renderer2D, have the non-proxied
    // version of a class we've proxied in their prototype chains. We need to
    // hack them so that they have the proxied version in their prototype
    // chains, so that the instanceof operator works properly.
    //
    // TODO: Technically, we ought to be traversing the whole prototype
    // chain here, but for now we'll just trust that there aren't any
    // p5 classes that subclass a non-proxied subclass of a proxied
    // subclass.
    Object.keys(p5).forEach(function(key) {
      if (!(/^[A-Z]/.test(key) && typeof(p5[key]) === 'function'))
        return;

      var proto = p5[key].prototype;
      var isProtoProxy = proxyPrototypes.has(proto);

      if (isProtoProxy) return;

      var protoProto = Object.getPrototypeOf(proto);

      if (!prototypeProxies.has(protoProto)) return;

      p5[key].prototype = new Proxy(p5[key].prototype, {
        getPrototypeOf: function(target) {
          return prototypeProxies.get(Object.getPrototypeOf(target));
        }
      });
    });
  };
});
