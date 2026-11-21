/**
 * Re-mounts on every dashboard route change, so each screen fades in like an
 * app screen instead of popping in. Phones only, and opacity only: a
 * transform here would turn this wrapper into the containing block of every
 * `position: fixed` child (floating "Nueva orden", full-screen forms) for the
 * length of the animation.
 */
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return (
    // `.screen-in` (globals.css): opacity-only keyframes — tailwindcss-animate's
    // fade still sets a transform in its first frame.
    <div className="screen-in">
      {children}
    </div>
  )
}
