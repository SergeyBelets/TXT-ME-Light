console.log('[posts.js] v: 2026-02-27-v9');
/**
 * models/posts.js — модель постов.
 * Загрузка, создание, обновление, удаление.
 * Результаты пишет в store.
 */

import { postsAPI } from '../api.js';
import store from '../store.js';

const postsModel = {
  /**
   * Загрузить ленту V2 и записать в store.
   * @param {{since?, until?, day?, tag?, author?}} params
   */
  async loadFeed(params = {}) {
    store.set('loading', true);
    store.set('error', null);
    try {
      const data = await postsAPI.getV2(params);
      const items = data?.items ?? [];
      const page  = data?.page  ?? {};

      store.set('posts', items);
      store.set('pageMeta', {
        prevUntil: page.prevUntil ?? null,
        nextSince: page.nextSince ?? null,
      });
    } catch (err) {
      store.set('error', err.message);
      store.set('posts', []);
    } finally {
      store.set('loading', false);
    }
  },

  /**
   * Загрузить один пост и записать в store.currentPost.
   * @param {string} postId
   */
  async loadPost(postId) {
    store.set('loading', true);
    store.set('error', null);
    try {
      const post = await postsAPI.getById(postId);
      console.log('[posts] loadPost result keys:', Object.keys(post ?? {}));
      store.set('currentPost', post);
    } catch (err) {
      store.set('error', err.message);
      store.set('currentPost', null);
    } finally {
      store.set('loading', false);
    }
  },

  /**
   * Создать пост.
   * @param {{title, content, tags?, media?, postAvatarId?}} data
   * @returns {Promise<object>} созданный пост
   */
  async create(data) {
    const res = await postsAPI.create(data);
    return res?.post ?? res;
  },

  /**
   * Обновить пост.
   * @param {string} postId
   * @param {object} data
   * @returns {Promise<object>}
   */
  async update(postId, data) {
    return postsAPI.update(postId, data);
  },

  /**
   * Удалить пост.
   * @param {string} postId
   */
  async delete(postId) {
    await postsAPI.delete(postId);
    // Убираем из ленты если он там есть
    const posts = store.get('posts').filter(p => p.postId !== postId);
    store.set('posts', posts);
    if (store.get('currentPost')?.postId === postId) {
      store.set('currentPost', null);
    }
  },
};

export default postsModel;
