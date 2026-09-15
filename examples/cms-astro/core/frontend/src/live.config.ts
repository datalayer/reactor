import { defineLiveCollection } from 'astro:content';

import { cmsLoader } from './lib/loader';

const apiUrl = process.env.CMS_API_URL;
const site = process.env.CMS_SITE;

export const collections = {
  posts: defineLiveCollection({ loader: cmsLoader({ apiUrl, site, collection: 'posts' }) }),
  pages: defineLiveCollection({ loader: cmsLoader({ apiUrl, site, collection: 'pages' }) }),
};
