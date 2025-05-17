import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { validate as isUuid } from 'uuid';
import { DatabaseError } from 'pg-protocol';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product } from './entities/product.entity';
import { PaginationDTO } from 'src/common/dtos/pagination.dto';
import { ProductImage } from './entities/product-image.entity';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger('ProductsService');
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(ProductImage)
    private readonly productImagesRepository: Repository<ProductImage>,
  ) {}

  async create(createProductDto: CreateProductDto) {
    try {
      const { images = [], ...productDetails } = createProductDto;
      const product = this.productRepository.create({
        ...productDetails,
        images: images.map((img) =>
          this.productImagesRepository.create({ url: img }),
        ),
      });
      await this.productRepository.save(product);
      return { ...product, images };
    } catch (error) {
      this.handleDBErrors(error as DatabaseError);
    }
  }

  async findAll(pagination: PaginationDTO) {
    const { limit = 10, offset = 0 } = pagination;
    try {
      const products = await this.productRepository.find({
        skip: offset,
        take: limit,
        relations: {
          images: true,
        },
      });
      return products.map((product) => ({
        ...product,
        images: product.images?.map((image) => image.url),
      }));
    } catch (error) {
      this.handleDBErrors(error as DatabaseError);
    }
  }

  async findOne(term: string) {
    let product: Product | null;

    if (isUuid(term)) {
      product = await this.productRepository.findOneBy({ id: term });
    } else {
      const queryBuilder = this.productRepository.createQueryBuilder('prod');
      product = await queryBuilder
        .where(`LOWER(title) = :title or slug = :slug`, {
          slug: term.toLowerCase(),
          title: term.toLowerCase(),
        })
        .leftJoinAndSelect('prod.images', 'prodImages')
        .getOne();
    }

    if (!product) {
      throw new NotFoundException(`Product with ${term} not found`);
    }

    return product;
  }

  async findOnePlain(term: string) {
    const { images = [], ...product } = await this.findOne(term);
    return { product, images: images.map((img) => img.url) };
  }

  async update(id: string, updateProductDto: UpdateProductDto) {
    const product = await this.productRepository.preload({
      id,
      ...updateProductDto,
      images: [],
    });

    if (!product)
      throw new BadRequestException(`Product with id: ${id} was not found`);

    try {
      await this.productRepository.save(product);
      return product;
    } catch (error) {
      this.handleDBErrors(error as DatabaseError);
    }
  }

  async remove(id: string) {
    const product = await this.findOne(id);
    const deleteProduct = await this.productRepository.remove(product);
    return deleteProduct;
  }

  private handleDBErrors(error: DatabaseError) {
    if (error.code === '23505') {
      throw new BadRequestException(error.detail);
    }
    this.logger.error(error);
    throw new InternalServerErrorException('Please check server logs');
  }
}
