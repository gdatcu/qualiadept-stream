import React from 'react';
import { ArrowUpDown, Search, SlidersHorizontal, X } from 'lucide-react';

export type SortOption = 'recent' | 'rating' | 'year' | 'az';

interface BrowseFilterBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  genres: Array<{ name: string; count: number }>;
  selectedGenre: string | null;
  onSelectGenre: (genre: string | null) => void;
  sortBy: SortOption;
  onSortChange: (sort: SortOption) => void;
  totalMatching: number;
}

export const BrowseFilterBar: React.FC<BrowseFilterBarProps> = ({
  searchQuery,
  onSearchChange,
  genres,
  selectedGenre,
  onSelectGenre,
  sortBy,
  onSortChange,
  totalMatching,
}) => {
  const hasActiveFilter = Boolean(searchQuery.trim() || selectedGenre || sortBy !== 'recent');

  return (
    <section className="mx-auto mb-6 max-w-[1600px] px-4 sm:px-8">
      {/* Search + Sort Row */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search movies, series, genres, or year..."
            className="w-full rounded-xl border border-white/15 bg-surface/90 py-2.5 pl-10 pr-9 text-sm text-white placeholder-zinc-400 outline-none backdrop-blur-md transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/25"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-surface/80 px-3 py-2 text-xs text-zinc-300">
            <ArrowUpDown className="h-3.5 w-3.5 text-violet-400" />
            <select
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value as SortOption)}
              aria-label="Sort titles"
              className="bg-transparent text-xs font-semibold text-white outline-none cursor-pointer"
            >
              <option value="recent" className="bg-obsidian">
                Recently Added
              </option>
              <option value="rating" className="bg-obsidian">
                Top Rated
              </option>
              <option value="year" className="bg-obsidian">
                Year (Newest)
              </option>
              <option value="az" className="bg-obsidian">
                Title (A–Z)
              </option>
            </select>
          </div>

          {hasActiveFilter && (
            <button
              type="button"
              onClick={() => {
                onSearchChange('');
                onSelectGenre(null);
                onSortChange('recent');
              }}
              className="flex items-center gap-1 rounded-xl border border-violet-400/35 bg-violet-500/15 px-3 py-2 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/25"
            >
              <X className="h-3.5 w-3.5" />
              Reset ({totalMatching})
            </button>
          )}
        </div>
      </div>

      {/* Horizontal Scrollable Genre Filter Pills */}
      {genres.length > 0 && (
        <div className="mt-3 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          <span className="hidden sm:inline-flex flex-shrink-0 items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500 mr-1">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Genres
          </span>

          <button
            type="button"
            onClick={() => onSelectGenre(null)}
            className={`flex-shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
              selectedGenre === null
                ? 'border-violet-400 bg-violet-600 text-white shadow-md shadow-violet-600/25'
                : 'border-white/10 bg-white/5 text-zinc-300 hover:border-white/25 hover:bg-white/10 hover:text-white'
            }`}
          >
            All Genres
          </button>

          {genres.map((g) => {
            const active = selectedGenre === g.name;
            return (
              <button
                key={g.name}
                type="button"
                onClick={() => onSelectGenre(active ? null : g.name)}
                className={`flex flex-shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                  active
                    ? 'border-violet-400 bg-violet-600 text-white shadow-md shadow-violet-600/25'
                    : 'border-white/10 bg-white/5 text-zinc-300 hover:border-white/25 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span>{g.name}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${
                    active ? 'bg-white/20 text-white' : 'bg-white/10 text-zinc-400'
                  }`}
                >
                  {g.count}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};
