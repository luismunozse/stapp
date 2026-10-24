package ar.com.stapp.app;

import java.util.HashSet;
import java.util.Set;

/**
 * Computes the extra origin rules that must receive the Capacitor native bridge script.
 *
 * Capacitor only registers its document-start script for the origin of {@code server.url}.
 * Wildcard hosts listed in {@code server.allowNavigation} are not covered, so they need
 * their own rules.
 */
final class BridgeOrigins {

    private BridgeOrigins() {}

    /**
     * Maps the {@code allowNavigation} entries to WebViewCompat origin rules.
     *
     * Only wildcard entries are returned: exact hosts are already covered by Capacitor, and
     * registering the same origin twice would load the bridge twice.
     */
    static Set<String> fromAllowNavigation(String[] allowNavigation) {
        Set<String> origins = new HashSet<>();
        if (allowNavigation == null) {
            return origins;
        }
        for (String entry : allowNavigation) {
            if (entry == null) {
                continue;
            }
            String host = entry.trim();
            if (host.startsWith("*.")) {
                origins.add("https://" + host);
            } else if (host.startsWith("http") && host.contains("*.")) {
                origins.add(host);
            }
        }
        return origins;
    }
}
