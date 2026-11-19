import { createBrowserRouter } from 'react-router';
import { AppLayout } from './layout';
import { NotFoundPage, ProjectListPage, ProjectPage } from './pages';

export const router = createBrowserRouter(
  [
    {
      element: <AppLayout />,
      children: [
        { index: true, element: <ProjectListPage /> },
        { path: 'projects/:projectId', element: <ProjectPage /> },
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
);
