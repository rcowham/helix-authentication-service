//
// Copyright 2020 Perforce Software
//
const { AssertionError } = require('assert')
const { assert } = require('chai')
const { before, describe, it } = require('mocha')
const User = require('@login/domain/entities/User')
const RedisUserRepository = require('@login/data/repositories/RedisUserRepository')

process.env.REDIS_URL = 'redis://redis.doc:6379'

describe('RedisUser repository', function () {
  let repository

  before(function () {
    repository = new RedisUserRepository()
  })

  it('should raise an error for invalid input', function () {
    assert.throws(() => repository.add(null), AssertionError)
    assert.throws(() => repository.add('foobar', null), AssertionError)
    assert.throws(() => repository.take(null), AssertionError)
  })

  it('should return null for missing user entity', async function () {
    // act
    const user = await repository.take('foobar')
    // assert
    assert.isNull(user)
  })

  it('should find an existing user entity once', async function () {
    // arrange
    const userId = 'joeuser'
    const tUser = new User(userId, { name: 'joe', email: 'joe@example.com' })
    repository.add(userId, tUser)
    // act
    const user = await repository.take(userId)
    // assert
    assert.equal(user.id, userId)
    assert.property(user, 'profile')
    assert.property(user.profile, 'email')
    // cannot retrieve the same entity a second time
    assert.isNull(await repository.take(userId))
  })
})
