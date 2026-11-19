import { Outlet } from 'react-router';
import { AutosaveProvider } from '@/features/floorplan/save/autosave-provider';
import { repository } from '@/features/projects/queries';

/** One autosave for every signed-in page, so retries continue wherever the user goes. */
export function AutosaveLayout() {
  return (
    <AutosaveProvider repository={repository}>
      <Outlet />
    </AutosaveProvider>
  );
}
