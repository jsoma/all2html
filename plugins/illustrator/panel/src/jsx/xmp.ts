/**
 * XMP metadata read/write for document-level settings persistence.
 * Uses Adobe's AdobeXMPScript external object.
 */

var XMP_NAMESPACE = "http://all2html.dev/1.0/";
var XMP_PREFIX = "all2html:";
var XMP_DATA_KEY = "data";

var _xmpLoaded = false;

function ensureXmp(): void {
  if (!_xmpLoaded) {
    if ((ExternalObject as any).AdobeXMPScript === undefined) {
      (ExternalObject as any).AdobeXMPScript = new ExternalObject(
        "lib:AdobeXMPScript",
      );
    }
    // Register namespace on first load
    XMPMeta.registerNamespace(XMP_NAMESPACE, XMP_PREFIX);
    _xmpLoaded = true;
  }
}

/**
 * Read a string property from the active document's XMP metadata.
 */
function xmpGetVariable(key: string): string | null {
  ensureXmp();
  var doc = app.activeDocument;
  var xmp = new XMPMeta(doc.XMPString);
  if (xmp.doesPropertyExist(XMP_NAMESPACE, key)) {
    return xmp.getProperty(XMP_NAMESPACE, key).value;
  }
  return null;
}

/**
 * Write a string property to the active document's XMP metadata.
 */
function xmpSetVariable(key: string, value: string): void {
  ensureXmp();
  var doc = app.activeDocument;
  var xmp = new XMPMeta(doc.XMPString);
  xmp.setProperty(XMP_NAMESPACE, key, value);
  doc.XMPString = xmp.serialize();
}

/**
 * Delete a property from the active document's XMP metadata.
 */
function xmpDeleteVariable(key: string): void {
  ensureXmp();
  var doc = app.activeDocument;
  var xmp = new XMPMeta(doc.XMPString);
  if (xmp.doesPropertyExist(XMP_NAMESPACE, key)) {
    xmp.deleteProperty(XMP_NAMESPACE, key);
    doc.XMPString = xmp.serialize();
  }
}

export { xmpGetVariable, xmpSetVariable, xmpDeleteVariable, XMP_DATA_KEY };
