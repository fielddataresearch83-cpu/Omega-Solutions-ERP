import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { getLocalDisposableTestDatabaseUrl } from './helpers/disposable-database.js';

const testDatabaseUrl = getLocalDisposableTestDatabaseUrl();
const suite = testDatabaseUrl ? describe : describe.skip;

suite('AppController (e2e)', () => {
  beforeAll(() => {
    process.env.JWT_SECRET ??= 'test-only-jwt-secret-for-app-e2e-tests-32-chars';
  });
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  it('/api (GET)', () => {
    return request(app.getHttpServer())
      .get('/api')
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    if (app) await app.close();
  });
});
