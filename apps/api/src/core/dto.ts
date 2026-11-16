import {
  IsString,
  IsIn,
  MinLength,
  MaxLength,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  Max,
  IsArray,
  ArrayMaxSize,
  IsEmail,
  IsISO8601,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
export const categories = ['GENERAL', 'HELP', 'MARKET', 'LOST', 'TREEHOLE', 'GUIDE'];
export class WechatLoginDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(256) code!: string;
}
export class DemoLoginDto {
  @ApiProperty() @IsIn(['student', 'peer', 'other', 'unverified', 'admin']) role!: string;
}
export class AdminLoginDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) password!: string;
}
export class ProfileDto {
  @ApiProperty() @IsString() @Matches(/\S/) @MinLength(2) @MaxLength(20) nickname!: string;
}
export class PostDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) schoolId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) campusId!: string;
  @ApiProperty({ enum: categories }) @IsIn(categories) category!: string;
  @ApiProperty() @IsString() @Matches(/\S/) @MinLength(2) @MaxLength(60) title!: string;
  @ApiProperty() @IsString() @Matches(/\S/) @MinLength(5) @MaxLength(2000) content!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() anonymous?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100000000) priceFen?: number;
  @IsOptional() @IsIn(['SELL', 'WANTED']) marketType?: string;
  @IsOptional() @IsString() @MaxLength(30) condition?: string;
  @IsOptional() @IsString() @MaxLength(100) location?: string;
  @IsOptional() @IsISO8601() happenedAt?: string;
  @IsOptional() @IsIn(['LOST', 'FOUND']) lostType?: string;
  @IsOptional() @IsString() @MaxLength(100) contact?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) mediaIds?: string[];
  @IsOptional() @IsBoolean() draft?: boolean;
}
export class FeedQuery {
  @IsOptional() @IsString() @MaxLength(100) schoolId?: string;
  @IsOptional() @IsString() @MaxLength(100) campusId?: string;
  @IsOptional() @IsIn(categories) category?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['latest', 'hot']) sort?: string;
  @IsOptional() @IsString() @MaxLength(500) cursor?: string;
}
export class CommentDto {
  @ApiProperty() @IsString() @Matches(/\S/) @MinLength(1) @MaxLength(500) content!: string;
  @IsOptional() @IsString() @MaxLength(100) parentId?: string;
}
export class StateDto {
  @IsIn(['ACTIVE', 'SOLD', 'FOUND', 'SOLVED', 'CLOSED']) state!: string;
}
export class ReactionDto {
  @IsIn(['LIKE', 'BOOKMARK']) type!: string;
  @IsBoolean() active!: boolean;
}
export class ReportDto {
  @IsString() @MinLength(2) @MaxLength(500) reason!: string;
  @IsOptional() @IsString() commentId?: string;
}
export class ReasonDto {
  @IsString() @MinLength(2) @MaxLength(500) reason!: string;
}
export class ReviewDto {
  @IsIn(['APPROVE', 'REJECT', 'HIDE']) decision!: string;
  @IsString() @MinLength(2) @MaxLength(500) reason!: string;
  @IsInt() @Min(1) version!: number;
}
export class CommentReviewDto {
  @IsIn(['APPROVE', 'REJECT', 'HIDE']) decision!: string;
  @IsString() @MinLength(2) @MaxLength(500) reason!: string;
}
export class VerifyDto {
  @IsString() @MinLength(1) @MaxLength(100) schoolId!: string;
  @IsString() @MinLength(1) @MaxLength(100) materialId!: string;
}
export class VerifyEmailDto {
  @IsString() @MaxLength(100) schoolId!: string;
  @IsEmail() @MaxLength(200) email!: string;
}
export class VerifyCodeDto {
  @IsString() @MaxLength(100) id!: string;
  @IsString() @Matches(/^\d{6}$/) code!: string;
}
export class VerifyReviewDto {
  @IsBoolean() approve!: boolean;
  @IsString() @MinLength(2) @MaxLength(500) reason!: string;
}
export class BanDto {
  @IsBoolean() banned!: boolean;
  @IsString() @MinLength(2) @MaxLength(500) reason!: string;
}
export class SchoolDto {
  @IsString() @Matches(/^[a-z0-9-]{2,40}$/) id!: string;
  @IsString() @MinLength(2) @MaxLength(60) name!: string;
  @IsArray()
  @ArrayMaxSize(10)
  @Matches(/^[a-z0-9.-]+\.[a-z]{2,}$/i, { each: true })
  emailDomains!: string[];
  @IsBoolean() treeholeEnabled!: boolean;
}
export class CampusDto {
  @IsString() @Matches(/^[a-z0-9-]{2,40}$/) id!: string;
  @IsString() @MinLength(2) @MaxLength(60) name!: string;
  @IsString() @MaxLength(100) schoolId!: string;
}
export class ConsentDto {
  @IsString() @MaxLength(200) templateId!: string;
  @IsIn(['accept', 'reject']) state!: string;
}
