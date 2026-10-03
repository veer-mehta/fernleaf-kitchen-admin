import { Module } from "@nestjs/common";
import { CompaniesController } from "./companies.controller";
import { CompaniesService } from "./companies.service";
import { CompanyPartsService } from "./company-parts.service";

@Module({ controllers: [CompaniesController], providers: [CompaniesService, CompanyPartsService] })
export class CompaniesModule {}
