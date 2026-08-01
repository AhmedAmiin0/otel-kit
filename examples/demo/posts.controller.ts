import { Body, Controller, Post } from '@nestjs/common';
import { PostsService, type Draft } from './posts.service';

@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Post()
  create(@Body() draft: Draft): Promise<unknown> {
    return this.posts.publish(draft);
  }
}
