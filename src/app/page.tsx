import { MapCanvas } from "@/components/map/MapCanvas";
import { MapProvider } from "@/components/map/MapProvider";
import { BasemapToggle } from "@/components/shell/BasemapToggle";
import { CameraReadout } from "@/components/shell/CameraReadout";
import { MapControls } from "@/components/shell/MapControls";
import { SearchBar } from "@/components/shell/SearchBar";

export default function HomePage() {
  return (
    <MapProvider>
      <main className="relative h-dvh w-full overflow-hidden">
        <MapCanvas />
        <SearchBar />
        <MapControls />
        <BasemapToggle />
        <CameraReadout />
      </main>
    </MapProvider>
  );
}
