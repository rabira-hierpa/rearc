// A server component on purpose: Preline dropdowns are driven entirely by
// data attributes, so pure-markup chrome like this never ships React code.

export function SearchBar() {
  return (
    <div className="absolute top-4 left-4 z-10 w-[min(92vw,25rem)]">
      <div className="flex items-center gap-x-1 rounded-full bg-white py-1.5 pr-2 pl-1.5 shadow-lg shadow-gray-900/10 ring-1 ring-gray-900/5">
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

        <input
          type="search"
          disabled
          placeholder="Search stops and routes (Part 3)"
          aria-label="Search the map"
          className="min-w-0 flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-400 focus:outline-hidden disabled:cursor-not-allowed"
        />

        <span className="inline-flex size-9 shrink-0 items-center justify-center text-gray-400">
          <SearchIcon />
        </span>
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

function SearchIcon() {
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
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
