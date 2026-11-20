import { createBrowserRouter } from 'react-router';
import { SignInPage } from '@/features/auth/sign-in-page';
import { RequireSession } from '@/features/auth/session';
import { ProjectListPage } from '@/features/projects/project-list-page';
import { AutosaveLayout } from './autosave-layout';
import { AppLayout } from './layout';
import { NotFoundPage } from './pages';

export const router = createBrowserRouter(
  [
    {
      element: <AppLayout />,
      HydrateFallback: () => null,
      children: [
        { path: 'sign-in', element: <SignInPage /> },
        {
          element: <RequireSession />,
          children: [
            {
              element: <AutosaveLayout />,
              children: [
                { index: true, element: <ProjectListPage /> },
                {
                  path: 'projects/:projectId',
                  lazy: async () => ({
                    Component: (await import('@/features/projects/project-page')).ProjectPage,
                  }),
                },
                {
                  path: 'projects/:projectId/floors/:floorId',
                  lazy: async () => ({
                    Component: (await import('@/features/floorplan/editor-page')).EditorPage,
                  }),
                },
              ],
            },
          ],
        },
        ...(import.meta.env.DEV
          ? [
              {
                path: 'dev/synthetic/:size',
                lazy: async () => ({
                  Component: (await import('@/features/floorplan/synthetic-page')).SyntheticPage,
                }),
              },
            ]
          : []),
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
);
