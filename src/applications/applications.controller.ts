import { Body, Controller, Get, Post, Res, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ApplicationsService } from './applications.service';
//import { created, fail } from './response/http-response';
@Controller('applications')
export class ApplicationsController {
    constructor(private readonly applicationsService: ApplicationsService){}
        @Post()
        create(@Body() body: any){
            return this.applicationsService.create(body);
        }
        @Get()
        findAll() {
            return this.applicationsService.findAll();
        }
}
