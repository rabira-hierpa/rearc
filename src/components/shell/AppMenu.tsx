// Still a server component in Part 3. It is passed into the (client) SearchBar
// as a prop from the page, which is a server component — so this markup is
// rendered on the server and its JSX never enters the client bundle.

export function AppMenu() {
  return (
    <div className="hs-dropdown relative inline-flex [--placement:bottom-left]">
      <button
        id="app-menu"
        type="button"
        aria-label="Open menu"
        className="hs-dropdown-toggle inline-flex size-9 shrink-0 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 focus:bg-gray-100 focus:outline-hidden"
      >
        <MenuIcon />
      </button>

      <div
        className="hs-dropdown-menu duration hs-dropdown-open:opacity-100 z-20 mt-2 hidden min-w-56 rounded-xl bg-white p-1 opacity-0 shadow-xl ring-1 ring-gray-900/5 transition-[opacity,margin]"
        role="menu"
        aria-orientation="vertical"
        aria-labelledby="app-menu"
      >
        <span className="block px-3 py-2 text-xs font-medium tracking-wide text-gray-400 uppercase">
          ReArc series
        </span>
        <a
          className="flex items-center gap-x-3 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 focus:bg-gray-100 focus:outline-hidden"
          href="https://github.com/rabira-hierpa/rearc"
          target="_blank"
          rel="noreferrer"
          role="menuitem"
        >
          Source on GitHub
        </a>
        <a
          className="flex items-center gap-x-3 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 focus:bg-gray-100 focus:outline-hidden"
          href="https://blog.rz-codes.com"
          target="_blank"
          rel="noreferrer"
          role="menuitem"
        >
          The blog series
        </a>
      </div>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}
