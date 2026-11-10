package ar.com.stapp.app;

import static org.junit.Assert.assertNotNull;

import org.junit.Test;

/**
 * MainActivity reaches into private Capacitor internals by reflection. These tests fail the
 * build if a Capacitor upgrade renames them, instead of shipping an APK stuck on the splash.
 */
public class CapacitorInternalsTest {

    @Test
    public void bridgeDeclaresGetJsInjector() throws Exception {
        assertNotNull(Class.forName("com.getcapacitor.Bridge").getDeclaredMethod("getJSInjector"));
    }

    @Test
    public void jsInjectorDeclaresGetScriptString() throws Exception {
        assertNotNull(Class.forName("com.getcapacitor.JSInjector").getDeclaredMethod("getScriptString"));
    }
}
