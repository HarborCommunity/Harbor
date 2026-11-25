/**
 * Release, resolution, seeders, size, audio, from, actions. With less room the audio column goes
 * first, its mark moves next to the name, and then the add-on's.
 */
export const ROW_GRID =
  "grid items-center gap-x-2.5 grid-cols-[minmax(0,1fr)_112px_84px_72px_76px] @min-[700px]/list:grid-cols-[minmax(0,1fr)_112px_84px_72px_148px_76px] @min-[800px]/list:gap-x-3.5 @min-[800px]/list:grid-cols-[minmax(0,1fr)_126px_100px_78px_160px_76px] @min-[928px]/list:grid-cols-[minmax(0,1fr)_126px_100px_78px_104px_160px_76px] @min-[1016px]/list:gap-x-[18px] @min-[1016px]/list:grid-cols-[minmax(0,1fr)_132px_112px_84px_116px_176px_76px]";

export const AUDIO_CELL = "hidden min-w-0 @min-[928px]/list:block";
export const AUDIO_MARK = "@min-[928px]/list:hidden";
export const FROM_CELL = "hidden min-w-0 @min-[700px]/list:block";
