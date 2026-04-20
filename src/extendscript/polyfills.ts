/* ES5 polyfills for ExtendScript environments.
 * ExtendScript is ES3 — it lacks most Array/Object/String methods added in ES5+.
 * These polyfills are installed at bundle load time.
 */

export function installPolyfills(): void {
  // --- Array methods ---

  if (typeof Array.isArray === "undefined") {
    (Array as any).isArray = (arg: any): arg is any[] =>
      Object.prototype.toString.call(arg) === "[object Array]";
  }

  if (typeof Array.prototype.map === "undefined") {
    (Array.prototype as any).map = function (callback: any, thisArg?: any) {
      var result = [];
      for (var i = 0; i < this.length; i++) {
        result.push(callback.call(thisArg, this[i], i, this));
      }
      return result;
    };
  }

  if (typeof Array.prototype.filter === "undefined") {
    (Array.prototype as any).filter = function (callback: any, thisArg?: any) {
      var result: any[] = [];
      for (var i = 0; i < this.length; i++) {
        if (callback.call(thisArg, this[i], i, this)) {
          result.push(this[i]);
        }
      }
      return result;
    };
  }

  if (typeof Array.prototype.forEach === "undefined") {
    (Array.prototype as any).forEach = function (callback: any, thisArg?: any) {
      for (var i = 0; i < this.length; i++) {
        callback.call(thisArg, this[i], i, this);
      }
    };
  }

  if (typeof Array.prototype.includes === "undefined") {
    (Array.prototype as any).includes = function (searchElement: any, fromIndex?: number) {
      var len = this.length;
      var i = fromIndex || 0;
      if (i < 0) i = Math.max(0, len + i);
      for (; i < len; i++) {
        if (this[i] === searchElement) return true;
      }
      return false;
    };
  }

  if (typeof Array.prototype.find === "undefined") {
    (Array.prototype as any).find = function (predicate: any, thisArg?: any) {
      for (var i = 0; i < this.length; i++) {
        if (predicate.call(thisArg, this[i], i, this)) return this[i];
      }
      return undefined;
    };
  }

  if (typeof Array.prototype.findIndex === "undefined") {
    (Array.prototype as any).findIndex = function (predicate: any, thisArg?: any) {
      for (var i = 0; i < this.length; i++) {
        if (predicate.call(thisArg, this[i], i, this)) return i;
      }
      return -1;
    };
  }

  // --- Object methods ---

  if (typeof Object.keys === "undefined") {
    (Object as any).keys = (obj: any) => {
      var result: string[] = [];
      for (var key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          result.push(key);
        }
      }
      return result;
    };
  }

  if (typeof Object.entries === "undefined") {
    (Object as any).entries = (obj: any) => {
      var result: [string, any][] = [];
      for (var key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          result.push([key, obj[key]]);
        }
      }
      return result;
    };
  }

  if (typeof Object.values === "undefined") {
    (Object as any).values = (obj: any) => {
      var result: any[] = [];
      for (var key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          result.push(obj[key]);
        }
      }
      return result;
    };
  }

  if (typeof Object.assign === "undefined") {
    (Object as any).assign = function (target: any) {
      for (var i = 1; i < arguments.length; i++) {
        var source = arguments[i];
        if (source != null) {
          for (var key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
              target[key] = source[key];
            }
          }
        }
      }
      return target;
    };
  }

  // --- String methods ---

  if (typeof String.prototype.includes === "undefined") {
    (String.prototype as any).includes = function (search: string, start?: number) {
      return this.indexOf(search, start || 0) !== -1;
    };
  }

  if (typeof String.prototype.trim === "undefined") {
    (String.prototype as any).trim = function () {
      return this.replace(/^\s+|\s+$/g, "");
    };
  }

  if (typeof String.prototype.startsWith === "undefined") {
    (String.prototype as any).startsWith = function (search: string, pos?: number) {
      var start = pos || 0;
      return this.substring(start, start + search.length) === search;
    };
  }

  if (typeof String.prototype.endsWith === "undefined") {
    (String.prototype as any).endsWith = function (search: string, length?: number) {
      var len = length === undefined ? this.length : length;
      return this.substring(len - search.length, len) === search;
    };
  }
}
