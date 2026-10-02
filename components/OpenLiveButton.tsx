'use client';

export function OpenLiveButton({ missionId }: { missionId: string | null }) {
  if (!missionId) return null;

  function openLive() {
    if (!missionId) return;
    window.open(`/live/${missionId}`, `envoy-live-${missionId}`, 'width=1400,height=900');
  }

  return (
    <button
      onClick={openLive}
      className="w-full text-left border border-accent bg-accent/10 hover:bg-accent/20 text-accent text-sm font-medium rounded-lg px-4 py-3 transition flex items-center justify-between"
    >
      <span>🖥 Open Live Browser View</span>
      <span className="text-xs opacity-70">↗</span>
    </button>
  );
}