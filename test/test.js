import * as fs from 'fs/promises';

async function test() {
  try {
    await fs.writeFile('test.txt', 'Hello, world!');
    console.log('File written successfully');
  } catch (error) {
    console.error('Error:', error);
  }
}

test();