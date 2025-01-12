// @ts-nocheck
import { Request, Response } from 'express'
import logger from '@vodafoneuk/aim-mocking-logger'
import chalk from 'chalk'

import cache from '@modules/cache'
import hashAutoFix from '@modules/hashAutoFix'
import configController from '@modules/configController'

import isSuccessStatus from './utils/isSuccessStatus'
import wait from './utils/wait'
import sendResponse from './utils/sendResponse'
import extendMockResponse from './helpers/extendMockResponse'

export default async function cacheController(req: Request, res: Response, body: unknown) {
  const isRecordingEnabled = configController.getSessionConfig(req, 'recording')
  const isMockingEnabled = configController.getSessionConfig(req, 'mocking')
  logger.debug('cacheController').yarn.whisper(`recording: ${isRecordingEnabled} | mocking: ${isMockingEnabled}`)

  // If mocking and recording enabled at the same time
  if (isRecordingEnabled && isMockingEnabled) {
    logger.console.warn('AIM', 'DISABLED - mocking and recording cannot be enabled at the same time')
    return sendResponse(res, body, 400)
  }

  // If response success or error
  // - and if recording is enabled
  // - we don't need to check if response is successful or not since recording works for both
  if (isRecordingEnabled) {
    logger.console.warn('AIM', 'recording in progress')
    const cacheExists = await cache.exists(req)
    const isForceCacheUpdate = configController.getSessionConfig(req, 'updateCache')
    // If cache exists but force update has not been set - do nothing
    if (cacheExists && !isForceCacheUpdate) {
      logger.yarn.status('cache:update', 'cache already exists', 0)
      logger.yarn.status('cache:update', 'returning existing cache data', true)
      // If cache already exists and was not updated
      // We return the mock response instead of original response
      // We can't use status driven response in that case!
      // We want to return a mock instead of original response when recording to confirm what was recorded
      body = await cache.retrieve(req)
      body = await extendMockResponse(req, res, body)
      return body
    }
    logger.yarn.status('cache:update', 'cache has been updated', true)
    // Save new mocks
    await cache.store(req, body, res.statusCode)
    // We want to return a mock instead of original response when recording to confirm what was recorded
    body = await cache.retrieve(req)
    body = await extendMockResponse(req, res, body)
    return body
  }

  logger.debug('cacheController').yarn.whisper(`1`)

  // If response error
  // do nothing and return original body response
  if (!isSuccessStatus(res.statusCode) && !isMockingEnabled) {
    logger.console.warn('AIM', 'mocking is disabled')
    return body
  }

  logger.debug('cacheController').yarn.whisper(`2`)
  logger.debug('cacheController').yarn.whisper(res.statusCode)

  // If response success
  // serve mocks instead of original response
  logger.debug('cacheController').yarn.whisper(`no success response`)
  let status = 200
  const cacheExists = await cache.exists(req)
  // Add request as to a track list
  hashAutoFix.track(req)
  // return original response if no mock exists
  if (!cacheExists) {
    logger.group('cache').yarn.status('cache:retrieve', 'no cache exist', false)
    const expectedCacheFilePath = await cache.getCacheFilePath(req)
    if (expectedCacheFilePath) logger.group('cache').yarn.whisper(`to fix missing mock create: ${chalk.red(`${expectedCacheFilePath}.json`)}`)
    logger.group('cache').flush()
    return sendResponse(res, body, 400)
  }

  // Update mock with meta
  logger.yarn.whisper('mock exists: update meta')
  await cache.update(req, res)
  res.statusCode = 200
  // Retrieve cache data
  let cachedData = await cache.retrieve(req)
  // Extend mock data
  cachedData = await extendMockResponse(req, res, cachedData)
  // Delay api response
  if (cachedData.__cacheMeta && cachedData.__cacheMeta.delay) await wait(cachedData.__cacheMeta.delay)
  // handle status driven responses
  if (cachedData?.__cacheMeta?.status) status = cachedData.__cacheMeta.status
  // If no body, this is a proxy error request, and we need to send instead of returning
  if (body === null) {
    logger.group('cache').yarn.status('cache:retrieve', `cache served [status: ${status}]`, true)
    logger.group('cache').flush()
    return res.status(status).send(cachedData)
  }

  return cachedData
}
