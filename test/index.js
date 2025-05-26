import express from 'express'
import puppeteer from 'puppeteer';
import path from 'path';

const app = express()

app.get('/', async (req, res) => {

  const browser = await puppeteer.launch({
    headless: false,
  });

  await browser.newPage();

  res.send('Hello World')




})

app.listen(8080)