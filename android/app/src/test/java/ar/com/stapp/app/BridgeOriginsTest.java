package ar.com.stapp.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import org.junit.Test;

public class BridgeOriginsTest {

    @Test
    public void mapsWildcardEntryToHttpsOrigin() {
        Set<String> origins = BridgeOrigins.fromAllowNavigation(new String[] {"*.stapp.com.ar"});
        assertEquals(Collections.singleton("https://*.stapp.com.ar"), origins);
    }

    @Test
    public void skipsExactHostBecauseCapacitorAlreadyCoversIt() {
        Set<String> origins = BridgeOrigins.fromAllowNavigation(new String[] {"stapp.com.ar"});
        assertTrue(origins.isEmpty());
    }

    @Test
    public void keepsAlreadySchemedWildcardAsIs() {
        Set<String> origins = BridgeOrigins.fromAllowNavigation(new String[] {"https://*.stapp.com.ar"});
        assertEquals(Collections.singleton("https://*.stapp.com.ar"), origins);
    }

    @Test
    public void mixedEntriesKeepOnlyWildcards() {
        Set<String> origins = BridgeOrigins.fromAllowNavigation(
            new String[] {"*.stapp.com.ar", "stapp.com.ar", "http://*.example.com"});
        Set<String> expected = new HashSet<>();
        expected.add("https://*.stapp.com.ar");
        assertEquals(expected, origins);
    }

    @Test
    public void nullYieldsEmptySet() {
        assertTrue(BridgeOrigins.fromAllowNavigation(null).isEmpty());
    }

    @Test
    public void emptyArrayYieldsEmptySet() {
        assertTrue(BridgeOrigins.fromAllowNavigation(new String[0]).isEmpty());
    }

    @Test
    public void skipsPlainHttpWildcardBecauseOnlyHttpsIsAllowed() {
        assertTrue(BridgeOrigins.fromAllowNavigation(new String[] {"http://*.example.com"}).isEmpty());
    }

    @Test
    public void skipsNullElements() {
        Set<String> origins = BridgeOrigins.fromAllowNavigation(new String[] {null, "*.stapp.com.ar"});
        assertEquals(Collections.singleton("https://*.stapp.com.ar"), origins);
    }

    @Test
    public void skipsNonWildcardSchemedHost() {
        assertTrue(BridgeOrigins.fromAllowNavigation(new String[] {"https://stapp.com.ar"}).isEmpty());
    }
}
