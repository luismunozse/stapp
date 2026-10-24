package ar.com.stapp.app;

import android.os.Bundle;
import android.util.Log;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import java.lang.reflect.Method;
import java.util.Set;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The WebView scales text by the system font size (e.g. 110%), which the web layouts do
        // not tolerate yet: amounts get truncated and cards overflow. Pin it to 100% until they do.
        getBridge().getWebView().getSettings().setTextZoom(100);
        injectBridgeOnWildcardOrigins();
    }

    /**
     * Capacitor registers its native bridge script (addDocumentStartJavaScript) only for the
     * origin of server.url (https://stapp.com.ar). That apex redirects to www.stapp.com.ar and,
     * after login, the app lives on <tenant>.stapp.com.ar, so no page would ever get the bridge:
     * plugins are "not implemented" and the splash never hides. We register the same script for
     * the wildcard hosts of server.allowNavigation.
     *
     * Relies on private Capacitor internals (Bridge#getJSInjector, JSInjector#getScriptString).
     * Re-check on every Capacitor upgrade; failures are logged loudly under "StappBridge".
     *
     * Caveat: this is a second getJSInjector() call. Capacitor's first call (in loadWebView)
     * already consumed miscJSFileInjections, so the script built here lacks them. A plugin using
     * injectScriptBeforeLoad would not get its script on wildcard origins; none does today.
     */
    private void injectBridgeOnWildcardOrigins() {
        try {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                return;
            }
            Bridge bridge = getBridge();
            Set<String> origins = BridgeOrigins.fromAllowNavigation(bridge.getConfig().getAllowNavigation());
            if (origins.isEmpty()) {
                return;
            }
            Method getInjector = Bridge.class.getDeclaredMethod("getJSInjector");
            getInjector.setAccessible(true);
            Object injector = getInjector.invoke(bridge);
            if (injector == null) {
                Log.e("StappBridge", "Capacitor returned no JS injector");
                return;
            }
            Method getScript = injector.getClass().getDeclaredMethod("getScriptString");
            getScript.setAccessible(true);
            String script = (String) getScript.invoke(injector);
            WebViewCompat.addDocumentStartJavaScript(bridge.getWebView(), script, origins);
        } catch (Exception e) {
            Log.e("StappBridge", "Could not inject the Capacitor bridge on wildcard origins", e);
        }
    }
}
