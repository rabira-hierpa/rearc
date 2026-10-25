import { MapCanvas } from "@/components/map/MapCanvas";
import { MapProvider } from "@/components/map/MapProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { AppMenu } from "@/components/shell/AppMenu";
import { BasemapToggle } from "@/components/shell/BasemapToggle";
import { CameraReadout } from "@/components/shell/CameraReadout";
import { LayerPanel } from "@/components/shell/LayerPanel";
import { LayersButton } from "@/components/shell/LayersButton";
import { MapControls } from "@/components/shell/MapControls";
import { SearchBar } from "@/components/shell/SearchBar";

export default function HomePage() {
  return (
    <QueryProvider>
      <MapProvider>
        <main className="relative h-dvh w-full overflow-hidden">
          <MapCanvas />
          {/* AppMenu is a server component handed to a client component as a
              prop — it renders on the server and ships no JSX to the browser. */}
          <SearchBar menu={<AppMenu />} />
          <MapControls />
          <BasemapToggle />
          <LayersButton />
          <CameraReadout />
        </main>
        <LayerPanel />
      </MapProvider>
    </QueryProvider>
  );
}
