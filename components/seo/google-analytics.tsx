"use client"

import Script from "next/script"

const isValidId = (id: string | undefined, prefix: string) =>
  !!id && id.startsWith(prefix) && !/X{3,}/i.test(id)

const GA_MEASUREMENT_ID = isValidId(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID, "G-")
  ? process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
  : undefined

const GOOGLE_ADS_ID = isValidId(process.env.NEXT_PUBLIC_GOOGLE_ADS_ID, "AW-")
  ? process.env.NEXT_PUBLIC_GOOGLE_ADS_ID
  : undefined

export function GoogleAnalytics() {
  if (!GA_MEASUREMENT_ID && !GOOGLE_ADS_ID) return null

  // El src de gtag.js debe contener un ID real para que Google detecte la etiqueta.
  // Preferimos GA si existe; si no, usamos el ID de Google Ads.
  const primaryId = GA_MEASUREMENT_ID || GOOGLE_ADS_ID

  return (
    <>
      {/* Google Consent Mode v2 - debe ir ANTES de gtag.js */}
      <Script id="google-consent-mode" strategy="beforeInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}

          gtag('consent', 'default', {
            analytics_storage: 'granted',
            ad_storage: 'granted',
            ad_user_data: 'granted',
            ad_personalization: 'granted',
            functionality_storage: 'granted',
            security_storage: 'granted',
          });
        `}
      </Script>

      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${primaryId}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          ${GA_MEASUREMENT_ID ? `gtag('config', '${GA_MEASUREMENT_ID}', {
            page_title: document.title,
            page_location: window.location.href,
          });` : ''}
          ${GOOGLE_ADS_ID ? `gtag('config', '${GOOGLE_ADS_ID}');` : ''}
        `}
      </Script>
    </>
  )
}
