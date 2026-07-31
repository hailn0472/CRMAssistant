import { Module, OnModuleInit } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module'
import { DealsModule } from '../deals/deals.module'
import { registerProductsGraphql } from './products.graphql'
import { ProductsService } from './products.service'
import { DealLineItemsService } from './deal-line-items.service'

@Module({
  imports: [PrismaModule, DealsModule],
  providers: [ProductsService, DealLineItemsService],
  exports: [ProductsService, DealLineItemsService],
})
export class ProductsModule implements OnModuleInit {
  constructor(
    private readonly productsService: ProductsService,
    private readonly dealLineItemsService: DealLineItemsService,
  ) {}

  onModuleInit(): void {
    registerProductsGraphql(this.productsService, this.dealLineItemsService)
  }
}
